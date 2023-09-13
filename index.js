const _ = require('lodash'),
  net = require('net'),
  BufferConcat = require('buffer-concat'),
  Iso_8583 = require('iso_8583'),
  xml2js = require('xml2js');

module.exports.ConnectAndSendMessage = function (data) {
  const { option, test_events } = data;

  return new Promise((resolve, reject) => {
    if (!_.isObject(option) || !_.isArray(test_events) || !_.isObject(_.get(test_events[0], 'data'))) {
      reject({
        target_id: '',
        status: 'error',
        message: '错误的请求参数',
        request: {},
        response: {},
        assert: [],
      });
    } else {
      // 当前接口信息
      const targetItem = _.get(test_events[0], 'data');

      // 获取tcp server 信息
      const serverHost = (([host, port = "110"]) => ({ host, port: Number(port) }))(
        _.chain(option?.collection)
          .find(item => item.target_id === targetItem?.parent_id)
          .get('url', '127.0.0.1:110')
          .split(':')
          .value()
      );

      // 要发送的消息信息
      const msgType = _.get(targetItem, 'request.body.type') ? _.get(targetItem, 'request.body.type') : 'json';
      const msgContent = _.get(targetItem, `request.body.${msgType}`);

      _.assign(serverHost, {
        message: {
          type: msgType,
          content: msgContent
        }
      });

      // 获取连接客户端
      const socketClient = new net.Socket();

      // 连接并发送
      socketClient.connect(serverHost.port, serverHost.host, () => {
        let writeData = '';

        switch (msgType) {
          case 'json':
            writeData = _.get(msgContent, 'raw');

            if (_.isObject(writeData)) {
              writeData = JSON.stringify(writeData)
            }

            if(!_.isString(writeData)){
              writeData = String(writeData)
            }
            break;
          case 'xml':
            writeData = new xml2js.Builder().buildObject(msgContent);
            break;
          case 'iso8583':
            const isoMsg = {};

            if (_.isArray(msgContent)) {
              _.forEach(msgContent, (item) => {
                isoMsg[String(item?.field)] = item?.value
              })
            }

            writeData = new Iso_8583(isoMsg).getBufferMessage();
            break;
          case 'raw':
          default:
            writeData = msgContent;
            break;
        }

        // 写入数据
        try {
          socketClient.write(writeData);
        } catch (err) {
          reject({
            target_id: targetItem?.target_id,
            status: 'error',
            message: String(err),
            request: serverHost,
            response: {},
            assert: [],
          });
        }
      });

      // 收到反馈数据
      socketClient.on('data', async (response) => {
        const resLength = _.size(response);
        response = String(response)

        try {
          switch (msgType) {
            case 'json':
              response = JSON.parse(response);
              break;
            case 'xml':
              xml2js.parseString(data, async (err, result) => {
                if (!err) {
                  response = result
                }
              });
              break;
            case 'iso8583':
              response = new Iso_8583(response);
              break;
          }

          resolve({
            target_id: targetItem?.target_id,
            status: 'success',
            message: 'success',
            request: serverHost,
            response: {
              raw: response,
              length: resLength
            },
            assert: []
            // assert: [
            //   {
            //     "status": "success",
            //     "expect": "响应码为 200",
            //     "result": "成功"
            //   }]
          });
        } catch (err) {
          reject({
            target_id: targetItem?.target_id,
            status: 'error',
            message: String(err),
            request: serverHost,
            response: {},
            assert: [],
          });
        } finally {
          socketClient.end();
        }
      });

      socketClient.on('close', () => { });

      // 错误回调
      socketClient.on('error', (err) => {
        reject({
          target_id: targetItem?.target_id,
          status: 'error',
          message: String(err),
          request: serverHost,
          response: {},
          assert: []
        });
      });
    }
  })
};
