const _ = require("lodash"),
  net = require("net"),
  Iso_8583 = require("iso_8583"),
  { parseString } = require('xml2js'),
  x2js = require('x2js');

module.exports.ConnectAndSendMessage = function (data) {
  const { option, test_events } = data;

  return new Promise((resolve, reject) => {
    if (
      !_.isObject(option) ||
      !_.isArray(test_events) ||
      !_.isObject(_.get(test_events[0], "data"))
    ) {
      reject({
        target_id: "",
        status: "error",
        message: "错误的请求参数",
        request: {},
        response: {},
        assert: [],
      });
    } else {
      // 当前接口信息
      const targetItem = _.get(test_events[0], "data");

      // 获取tcp server 信息
      const serverHost = (([host, port = "110"]) => ({
        host,
        port: Number(port),
      }))(
        _.chain(option?.collection)
          .find((item) => item.target_id === targetItem?.parent_id)
          .get("url", "127.0.0.1:110")
          .split(":")
          .value()
      );

      // 要发送的消息信息
      const msgType = _.get(targetItem, "request.body.mode")
        ? _.get(targetItem, "request.body.mode")
        : "json";
      const msgContent =
        msgType === "iso8583"
          ? _.get(targetItem, `request.body.parameter`)
          : _.get(targetItem, `request.body.raw`);

      _.assign(serverHost, {
        message: {
          type: msgType,
          content: msgContent,
        },
      });

      // 获取连接客户端
      const socketClient = new net.Socket();

      // 连接并发送
      socketClient.connect(serverHost.port, serverHost.host, () => {
        let writeData = "";

        switch (msgType) {
          case "iso8583":
            try {
              const isoMsg = {};

              if (_.isArray(msgContent)) {
                _.forEach(msgContent, (item) => {
                  isoMsg[String(item?.field)] = item?.value;
                });
              }

              writeData = new Iso_8583(isoMsg).getBufferMessage();
            } catch (e) { }
            break;
          default:
            writeData = msgContent;
            break;
        }

        // 写入数据
        try {
          // 请求参数数据处理
          _.forEach(_.get(targetItem, `request.configs.func.request`), function (item) {
            switch (item?.id) {
              case 'calcLengthToPacketHeader':
                if (_.isString(writeData)) {
                  writeData = _.join([_.take(_.padStart(_.size(writeData), Number(item?.option), 0), Number(item?.option)).join(''), writeData], '')
                }
                break;
              case 'addCharToPacketEnd':
                if (!_.isUndefined(item?.option)) {
                  switch (item?.option) {
                    case '\\n':
                      writeData = _.join([writeData, "\n"], '')
                      break;
                    case '\\r':
                      writeData = _.join([writeData, "\r"], '')
                      break;
                    case '\\t':
                      writeData = _.join([writeData, "\t"], '')
                      break;
                    case '\\b':
                      writeData = _.join([writeData, "\b"], '')
                      break;
                    case '\\f':
                      writeData = _.join([writeData, "\f"], '')
                      break;
                    case '\\\\':
                      writeData = _.join([writeData, "\\"], '')
                      break;
                    default:
                      writeData = _.join([writeData, String(item?.option)], '')
                      break;
                  }
                }

                break;
            }
          });
          console.log(writeData)
          socketClient.write(writeData);
        } catch (err) {
          reject({
            target_id: targetItem?.target_id,
            status: "error",
            message: String(err),
            request: serverHost,
            response: {},
            assert: [],
          });
        }
      });

      // 收到反馈数据
      socketClient.on("data", async (response) => {
        const resLength = _.size(response);
        response = String(response);

        try {
          switch (msgType) {
            case "iso8583":
              response = new Iso_8583(response);
              break;
          }
          // 响应参数数据处理
          _.forEach(_.get(targetItem, `request.configs.func.response`), function (item) {
            switch (item?.id) {
              case 'removePacketHeader':
                if (_.isString(response)) {
                  response = _.slice(response, Number(item?.option)).join('')
                }
                break;
              case 'removeWrapChar':
                if (!_.isUndefined(item?.option) && _.isString(response)) {
                  switch (item?.option) {
                    case '\\n':
                      response = _.trim(response, "\n")
                      break;
                    case '\\r':
                      response = _.trim(response, "\r")
                      break;
                    case '\\t':
                      response = _.trim(response, "\t")
                      break;
                    case '\\b':
                      response = _.trim(response, "\b")
                      break;
                    case '\\f':
                      response = _.trim(response, "\f")
                      break;
                    case '\\\\':
                      response = _.trim(response, "\\")
                      break;
                    default:
                      break;
                  }
                }

                break;
              case 'parseXmlToJson':
                try {
                  parseString(response, (error, result) => {
                    if (!error) {
                      try {
                        response = (new x2js()).xml2js(response);
                      } catch (err) { }
                    }
                  });
                } catch (err) { }
                break;
            }
          });

          resolve({
            target_id: targetItem?.target_id,
            status: "success",
            message: "success",
            request: serverHost,
            response: {
              raw: response,
              length: resLength,
            },
            assert: [],
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
            status: "error",
            message: String(err),
            request: serverHost,
            response: {},
            assert: [],
          });
        } finally {
          socketClient.end();
        }
      });

      socketClient.on("close", () => { });

      // 错误回调
      socketClient.on("error", (err) => {
        reject({
          target_id: targetItem?.target_id,
          status: "error",
          message: String(err),
          request: serverHost,
          response: {},
          assert: [],
        });
      });
    }
  });
};
