const _ = require("lodash"),
  net = require("net"),
  Iso_8583 = require("iso_8583"),
  { parseString } = require('xml2js'),
  chai = require('chai'),
  jsonpath = require('jsonpath'),
  xpath = require('xpath'),// for 7.2.3
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

          // 断言处理
          let _assert_script = [];
          _.forEach(_.get(targetItem, `request.post_tasks`), function (item) {
            if (_.isObject(item)) {
              switch (_.toLower(item.type)) {
                case 'socketassert':
                  if (item.enabled > 0) {
                    const ASSERT_TYPES = {
                      responseJson: {
                        value: 'pm.response.json()',
                        title: 'Response JSON',
                      },
                      responseXml: {
                        value: 'apt.response.text()',
                        title: 'Response XML',
                      },
                      responseText: {
                        value: 'apt.response.text()',
                        title: 'Response Text',
                      },
                      responseSize: {
                        value: 'pm.response.responseSize',
                        title: '响应大小',
                      }
                    };

                    const ASSERT_CONDITION = {
                      eq: { type: 'eql', title: '等于' },
                      uneq: { type: 'not.eql', title: '不等于' },
                      lt: { type: 'below', title: '小于' },
                      lte: { type: 'most', title: '小于或等于' },
                      gt: { type: 'above', title: '大于' },
                      gte: { type: 'least', title: '大于或等于' },
                      includes: { type: 'include', title: '包含' },
                      unincludes: { type: 'not.include', title: '不包含' },
                      null: { type: 'be.empty', title: '等于空' },
                      notnull: { type: 'not.be.empty', title: '不等于空' },
                      exist: { type: 'exist', title: '存在' },
                      notexist: { type: 'not.exist', title: '不存在' },
                      regularmatch: { type: 'match', title: '正则匹配' },
                      belongscollection: { type: 'oneOf', title: '属于集合' },
                      notbelongscollection: { type: 'not.oneOf', title: '不属于集合' },
                    }

                    // 断言标题
                    let _assert_title = `${ASSERT_TYPES[item?.data?.type]?.title}(${String(item?.data?.expression?.path)}) ${ASSERT_CONDITION[item?.data?.expression?.compareType]?.title} ${String(item?.data?.expression?.compareValue)}`;

                    if (_.isEmpty(item?.data?.expression?.path)) {
                      _assert_title = `${ASSERT_TYPES[item?.data?.type]?.title} ${ASSERT_CONDITION[item?.data?.expression?.compareType]?.title} ${String(item?.data?.expression?.compareValue)}`;
                    }

                    // 断言对比值
                    let _assert_value = null;
                    let _assert_func = _.identity;

                    if (['null', 'notnull', 'exist', 'notexist'].indexOf(item?.data?.expression?.compareType) == -1) {
                      if (['lt', 'lte', 'gt', 'gte'].indexOf(item?.data?.expression?.compareType) > -1) {
                        _assert_func = Number;
                        _assert_value = Number(item?.data?.expression?.compareValue);
                      } else if (item?.data?.expression?.compareType == 'regularmatch') {
                        _assert_value = item?.data?.expression?.compareValue;
                      } else if (['belongscollection', 'notbelongscollection'].indexOf(item?.data?.expression?.compareType) > -1) {
                        _assert_value = _.split(item?.data?.expression?.compareValue, ",").map(item => {
                          let num = _.toNumber(item);
                          return _.isNaN(num) ? `"${item}"` : num;
                        });
                      } else {
                        _assert_func = String;
                        _assert_value = item?.data?.expression?.compareValue;
                      }
                    }

                    // 开始断言
                    try {
                      let _expect_data = '';
                      let _assert_condition = String(ASSERT_CONDITION[item?.data?.expression?.compareType]?.type);

                      switch (item?.data?.type) {
                        case 'responseJson':
                          let res_obj = {};
                          if (_.isString(response)) {
                            try {
                              res_obj = JSON.parse(response);
                            } catch (e) { }
                          }

                          if (_.isObject(response)) {
                            res_obj = response;
                          }

                          _expect_data = _assert_func(jsonpath.value(res_obj, item?.data?.expression?.path))

                          break;
                        case 'responseXml':
                          try {
                            _expect_data = xpath.select(String(item?.data?.expression?.path), new dom().parseFromString(String(response), 'text/xml'));
                          } catch (e) { }
                          
                          break;
                        case 'responseText':
                          _expect_data = response;
                          break;
                        case 'responseSize':
                          _expect_data = resLength;
                          break;
                      }

                      let _chai_str = '';
                      if (!_.isNull(_assert_value)) {
                        _chai_str = `chai.expect(${JSON.stringify(_expect_data)}).to.${_assert_condition}(${JSON.stringify(_assert_value)})`;
                      } else {
                        _chai_str = `chai.expect(${JSON.stringify(_expect_data)}).to.${_assert_condition}`;
                      }

                      chai.expect(new Function('chai', _chai_str)(chai))

                      _assert_script.push({
                        "status": "success",
                        "expect": _assert_title,
                        "result": "成功"
                      })
                    } catch (e) {
                      _assert_script.push({
                        "status": "error",
                        "expect": _assert_title,
                        "result": "失败"
                      })
                    }
                  }
                  break;
              }
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
            assert: _assert_script
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
