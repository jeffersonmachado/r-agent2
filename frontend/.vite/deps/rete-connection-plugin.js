import {
  _get,
  _slicedToArray
} from "./chunk-7HAVDVRF.js";
import {
  BaseAreaPlugin,
  _toConsumableArray
} from "./chunk-KBNZICPF.js";
import {
  NodeEditor,
  Scope,
  _asyncToGenerator,
  _classCallCheck,
  _createClass,
  _defineProperty,
  _getPrototypeOf,
  _inherits,
  _possibleConstructorReturn,
  _typeof,
  getUID,
  require_regenerator
} from "./chunk-EYN7YZXN.js";
import {
  __toESM
} from "./chunk-PLDDJCW6.js";

// node_modules/rete-connection-plugin/rete-connection-plugin.esm.js
var import_regenerator = __toESM(require_regenerator());
function ownKeys(e, r) {
  var t = Object.keys(e);
  if (Object.getOwnPropertySymbols) {
    var o = Object.getOwnPropertySymbols(e);
    r && (o = o.filter(function(r2) {
      return Object.getOwnPropertyDescriptor(e, r2).enumerable;
    })), t.push.apply(t, o);
  }
  return t;
}
function _objectSpread(e) {
  for (var r = 1; r < arguments.length; r++) {
    var t = null != arguments[r] ? arguments[r] : {};
    r % 2 ? ownKeys(Object(t), true).forEach(function(r2) {
      _defineProperty(e, r2, t[r2]);
    }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r2) {
      Object.defineProperty(e, r2, Object.getOwnPropertyDescriptor(t, r2));
    });
  }
  return e;
}
function createPseudoconnection(extra) {
  var element = null;
  var id = null;
  function unmount(areaPlugin) {
    if (id) {
      areaPlugin.removeConnectionView(id);
    }
    element = null;
    id = null;
  }
  function mount(areaPlugin) {
    unmount(areaPlugin);
    id = "pseudo_".concat(getUID());
  }
  return {
    isMounted: function isMounted() {
      return Boolean(id);
    },
    mount,
    render: function render(areaPlugin, _ref, data) {
      var x = _ref.x, y = _ref.y;
      var isOutput = data.side === "output";
      var pointer = {
        x: x + (isOutput ? -3 : 3),
        y
      };
      if (!id) throw new Error("pseudo connection id wasn't generated");
      var payload = isOutput ? _objectSpread({
        id,
        source: data.nodeId,
        sourceOutput: data.key,
        target: "",
        targetInput: ""
      }, extra !== null && extra !== void 0 ? extra : {}) : _objectSpread({
        id,
        target: data.nodeId,
        targetInput: data.key,
        source: "",
        sourceOutput: ""
      }, extra !== null && extra !== void 0 ? extra : {});
      if (!element) {
        var view = areaPlugin.addConnectionView(payload);
        element = view.element;
      }
      if (!element) return;
      void areaPlugin.emit({
        type: "render",
        data: _objectSpread({
          element,
          type: "connection",
          payload
        }, isOutput ? {
          end: pointer
        } : {
          start: pointer
        })
      });
    },
    unmount
  };
}
function _createForOfIteratorHelper$1(r, e) {
  var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
  if (!t) {
    if (Array.isArray(r) || (t = _unsupportedIterableToArray$1(r)) || e && r && "number" == typeof r.length) {
      t && (r = t);
      var _n = 0, F = function F2() {
      };
      return { s: F, n: function n() {
        return _n >= r.length ? { done: true } : { done: false, value: r[_n++] };
      }, e: function e2(r2) {
        throw r2;
      }, f: F };
    }
    throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
  }
  var o, a = true, u = false;
  return { s: function s() {
    t = t.call(r);
  }, n: function n() {
    var r2 = t.next();
    return a = r2.done, r2;
  }, e: function e2(r2) {
    u = true, o = r2;
  }, f: function f() {
    try {
      a || null == t["return"] || t["return"]();
    } finally {
      if (u) throw o;
    }
  } };
}
function _unsupportedIterableToArray$1(r, a) {
  if (r) {
    if ("string" == typeof r) return _arrayLikeToArray$1(r, a);
    var t = {}.toString.call(r).slice(8, -1);
    return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray$1(r, a) : void 0;
  }
}
function _arrayLikeToArray$1(r, a) {
  (null == a || a > r.length) && (a = r.length);
  for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
  return n;
}
function findSocket(socketsCache, elements) {
  var _iterator = _createForOfIteratorHelper$1(elements), _step;
  try {
    for (_iterator.s(); !(_step = _iterator.n()).done; ) {
      var element = _step.value;
      var found = socketsCache.get(element);
      if (found) {
        return found;
      }
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }
}
function elementsFromPoint(x, y) {
  var _elements$;
  var root = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : document;
  var elements = root.elementsFromPoint(x, y);
  var shadowRoot = (_elements$ = elements[0]) === null || _elements$ === void 0 ? void 0 : _elements$.shadowRoot;
  if (shadowRoot && shadowRoot !== root) {
    elements.unshift.apply(elements, _toConsumableArray(elementsFromPoint(x, y, shadowRoot)));
  }
  return elements;
}
var Flow = _createClass(function Flow2() {
  _classCallCheck(this, Flow2);
});
var State = (function() {
  function State2() {
    _classCallCheck(this, State2);
  }
  return _createClass(State2, [{
    key: "setContext",
    value: function setContext(context) {
      this.context = context;
    }
  }]);
})();
function getSourceTarget(initial, socket) {
  var forward = initial.side === "output" && socket.side === "input";
  var backward = initial.side === "input" && socket.side === "output";
  var _ref = forward ? [initial, socket] : backward ? [socket, initial] : [], _ref2 = _slicedToArray(_ref, 2), source = _ref2[0], target = _ref2[1];
  if (source && target) return [source, target];
}
function canMakeConnection(initial, socket) {
  return Boolean(getSourceTarget(initial, socket));
}
function makeConnection(initial, socket, context) {
  var _ref3 = getSourceTarget(initial, socket) || [null, null], _ref4 = _slicedToArray(_ref3, 2), source = _ref4[0], target = _ref4[1];
  if (source && target) {
    void context.editor.addConnection({
      id: getUID(),
      source: source.nodeId,
      sourceOutput: source.key,
      target: target.nodeId,
      targetInput: target.key
    });
    return true;
  }
}
function _callSuper$2(t, o, e) {
  return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct$2() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e));
}
function _isNativeReflectConstruct$2() {
  try {
    var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {
    }));
  } catch (t2) {
  }
  return (_isNativeReflectConstruct$2 = function _isNativeReflectConstruct2() {
    return !!t;
  })();
}
var Picked$1 = (function(_State) {
  function Picked2(initial, params) {
    var _this;
    _classCallCheck(this, Picked2);
    _this = _callSuper$2(this, Picked2);
    _this.initial = initial;
    _this.params = params;
    return _this;
  }
  _inherits(Picked2, _State);
  return _createClass(Picked2, [{
    key: "pick",
    value: (function() {
      var _pick = _asyncToGenerator(import_regenerator.default.mark(function _callee(_ref, context) {
        var socket;
        return import_regenerator.default.wrap(function _callee$(_context) {
          while (1) switch (_context.prev = _context.next) {
            case 0:
              socket = _ref.socket;
              if (this.params.makeConnection(this.initial, socket, context)) {
                this.drop(context, socket, true);
              } else if (!this.params.pickByClick) {
                this.drop(context, socket);
              }
            case 2:
            case "end":
              return _context.stop();
          }
        }, _callee, this);
      }));
      function pick(_x, _x2) {
        return _pick.apply(this, arguments);
      }
      return pick;
    })()
  }, {
    key: "drop",
    value: function drop(context) {
      var socket = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : null;
      var created = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : false;
      if (this.initial) {
        void context.scope.emit({
          type: "connectiondrop",
          data: {
            initial: this.initial,
            socket,
            created
          }
        });
      }
      this.context.switchTo(new Idle$1(this.params));
    }
  }]);
})(State);
var Idle$1 = (function(_State2) {
  function Idle2(params) {
    var _this2;
    _classCallCheck(this, Idle2);
    _this2 = _callSuper$2(this, Idle2);
    _this2.params = params;
    return _this2;
  }
  _inherits(Idle2, _State2);
  return _createClass(Idle2, [{
    key: "pick",
    value: (function() {
      var _pick2 = _asyncToGenerator(import_regenerator.default.mark(function _callee2(_ref2, context) {
        var socket, event;
        return import_regenerator.default.wrap(function _callee2$(_context2) {
          while (1) switch (_context2.prev = _context2.next) {
            case 0:
              socket = _ref2.socket, event = _ref2.event;
              if (!(event === "down")) {
                _context2.next = 9;
                break;
              }
              _context2.next = 4;
              return context.scope.emit({
                type: "connectionpick",
                data: {
                  socket
                }
              });
            case 4:
              if (!_context2.sent) {
                _context2.next = 8;
                break;
              }
              this.context.switchTo(new Picked$1(socket, this.params));
              _context2.next = 9;
              break;
            case 8:
              this.drop(context);
            case 9:
            case "end":
              return _context2.stop();
          }
        }, _callee2, this);
      }));
      function pick(_x3, _x4) {
        return _pick2.apply(this, arguments);
      }
      return pick;
    })()
  }, {
    key: "drop",
    value: function drop(context) {
      var socket = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : null;
      var created = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : false;
      if (this.initial) {
        void context.scope.emit({
          type: "connectiondrop",
          data: {
            initial: this.initial,
            socket,
            created
          }
        });
      }
      delete this.initial;
    }
  }]);
})(State);
var BidirectFlow = (function() {
  function BidirectFlow2(params) {
    _classCallCheck(this, BidirectFlow2);
    var pickByClick = Boolean(params === null || params === void 0 ? void 0 : params.pickByClick);
    var makeConnection$1 = (params === null || params === void 0 ? void 0 : params.makeConnection) || makeConnection;
    this.switchTo(new Idle$1({
      pickByClick,
      makeConnection: makeConnection$1
    }));
  }
  return _createClass(BidirectFlow2, [{
    key: "pick",
    value: (function() {
      var _pick3 = _asyncToGenerator(import_regenerator.default.mark(function _callee3(params, context) {
        return import_regenerator.default.wrap(function _callee3$(_context3) {
          while (1) switch (_context3.prev = _context3.next) {
            case 0:
              _context3.next = 2;
              return this.currentState.pick(params, context);
            case 2:
            case "end":
              return _context3.stop();
          }
        }, _callee3, this);
      }));
      function pick(_x5, _x6) {
        return _pick3.apply(this, arguments);
      }
      return pick;
    })()
  }, {
    key: "getPickedSocket",
    value: function getPickedSocket() {
      return this.currentState.initial;
    }
  }, {
    key: "drop",
    value: function drop(context) {
      this.currentState.drop(context);
    }
  }, {
    key: "switchTo",
    value: function switchTo(state) {
      state.setContext(this);
      this.currentState = state;
    }
  }]);
})();
function findPort(socket, editor) {
  var node = editor.getNode(socket.nodeId);
  if (!node) throw new Error("cannot find node");
  var list = socket.side === "input" ? node.inputs : node.outputs;
  return list[socket.key];
}
function findConnections(socket, editor) {
  var nodeId = socket.nodeId, side = socket.side, key = socket.key;
  return editor.getConnections().filter(function(connection) {
    if (side === "input") {
      return connection.target === nodeId && connection.targetInput === key;
    }
    if (side === "output") {
      return connection.source === nodeId && connection.sourceOutput === key;
    }
  });
}
function syncConnections(sockets, editor) {
  var connections = sockets.map(function(socket) {
    var port = findPort(socket, editor);
    var multiple = port === null || port === void 0 ? void 0 : port.multipleConnections;
    if (multiple) return [];
    return findConnections(socket, editor);
  }).flat();
  return {
    commit: function commit() {
      var uniqueIds = Array.from(new Set(connections.map(function(_ref) {
        var id = _ref.id;
        return id;
      })));
      uniqueIds.forEach(function(id) {
        return void editor.removeConnection(id);
      });
    }
  };
}
function _callSuper$1(t, o, e) {
  return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct$1() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e));
}
function _isNativeReflectConstruct$1() {
  try {
    var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {
    }));
  } catch (t2) {
  }
  return (_isNativeReflectConstruct$1 = function _isNativeReflectConstruct2() {
    return !!t;
  })();
}
var Picked = (function(_State) {
  function Picked2(initial, params) {
    var _this;
    _classCallCheck(this, Picked2);
    _this = _callSuper$1(this, Picked2);
    _this.initial = initial;
    _this.params = params;
    return _this;
  }
  _inherits(Picked2, _State);
  return _createClass(Picked2, [{
    key: "pick",
    value: (function() {
      var _pick = _asyncToGenerator(import_regenerator.default.mark(function _callee(_ref, context) {
        var socket, created;
        return import_regenerator.default.wrap(function _callee$(_context) {
          while (1) switch (_context.prev = _context.next) {
            case 0:
              socket = _ref.socket;
              if (this.params.canMakeConnection(this.initial, socket)) {
                syncConnections([this.initial, socket], context.editor).commit();
                created = this.params.makeConnection(this.initial, socket, context);
                this.drop(context, created ? socket : null, created);
              }
            case 2:
            case "end":
              return _context.stop();
          }
        }, _callee, this);
      }));
      function pick(_x, _x2) {
        return _pick.apply(this, arguments);
      }
      return pick;
    })()
  }, {
    key: "drop",
    value: function drop(context) {
      var socket = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : null;
      var created = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : false;
      if (this.initial) {
        void context.scope.emit({
          type: "connectiondrop",
          data: {
            initial: this.initial,
            socket,
            created
          }
        });
      }
      this.context.switchTo(new Idle(this.params));
    }
  }]);
})(State);
var PickedExisting = (function(_State2) {
  function PickedExisting2(connection, params, context) {
    var _this2;
    _classCallCheck(this, PickedExisting2);
    _this2 = _callSuper$1(this, PickedExisting2);
    _this2.connection = connection;
    _this2.params = params;
    var outputSocket = Array.from(context.socketsCache.values()).find(function(data) {
      return data.nodeId === _this2.connection.source && data.side === "output" && data.key === _this2.connection.sourceOutput;
    });
    if (!outputSocket) throw new Error("cannot find output socket");
    _this2.outputSocket = outputSocket;
    return _this2;
  }
  _inherits(PickedExisting2, _State2);
  return _createClass(PickedExisting2, [{
    key: "init",
    value: (function() {
      var _init = _asyncToGenerator(import_regenerator.default.mark(function _callee2(context) {
        var _this3 = this;
        return import_regenerator.default.wrap(function _callee2$(_context2) {
          while (1) switch (_context2.prev = _context2.next) {
            case 0:
              void context.scope.emit({
                type: "connectionpick",
                data: {
                  socket: this.outputSocket
                }
              }).then(function(response) {
                if (response) {
                  void context.editor.removeConnection(_this3.connection.id);
                  _this3.initial = _this3.outputSocket;
                } else {
                  _this3.drop(context);
                }
              });
            case 1:
            case "end":
              return _context2.stop();
          }
        }, _callee2, this);
      }));
      function init(_x3) {
        return _init.apply(this, arguments);
      }
      return init;
    })()
  }, {
    key: "pick",
    value: (function() {
      var _pick2 = _asyncToGenerator(import_regenerator.default.mark(function _callee3(_ref2, context) {
        var socket, event, created, droppedSocket, _created, _droppedSocket;
        return import_regenerator.default.wrap(function _callee3$(_context3) {
          while (1) switch (_context3.prev = _context3.next) {
            case 0:
              socket = _ref2.socket, event = _ref2.event;
              if (this.initial && !(socket.side === "input" && this.connection.target === socket.nodeId && this.connection.targetInput === socket.key)) {
                if (this.params.canMakeConnection(this.initial, socket)) {
                  syncConnections([this.initial, socket], context.editor).commit();
                  created = this.params.makeConnection(this.initial, socket, context);
                  droppedSocket = created ? socket : null;
                  this.drop(context, droppedSocket, created);
                }
              } else if (event === "down") {
                if (this.initial) {
                  syncConnections([this.initial, socket], context.editor).commit();
                  _created = this.params.makeConnection(this.initial, socket, context);
                  _droppedSocket = _created ? null : socket;
                  this.drop(context, _droppedSocket, _created);
                }
              }
            case 2:
            case "end":
              return _context3.stop();
          }
        }, _callee3, this);
      }));
      function pick(_x4, _x5) {
        return _pick2.apply(this, arguments);
      }
      return pick;
    })()
  }, {
    key: "drop",
    value: function drop(context) {
      var socket = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : null;
      var created = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : false;
      if (this.initial) {
        void context.scope.emit({
          type: "connectiondrop",
          data: {
            initial: this.initial,
            socket,
            created
          }
        });
      }
      this.context.switchTo(new Idle(this.params));
    }
  }]);
})(State);
var Idle = (function(_State3) {
  function Idle2(params) {
    var _this4;
    _classCallCheck(this, Idle2);
    _this4 = _callSuper$1(this, Idle2);
    _this4.params = params;
    return _this4;
  }
  _inherits(Idle2, _State3);
  return _createClass(Idle2, [{
    key: "pick",
    value: (function() {
      var _pick3 = _asyncToGenerator(import_regenerator.default.mark(function _callee4(_ref3, context) {
        var socket, event, _connection, state;
        return import_regenerator.default.wrap(function _callee4$(_context4) {
          while (1) switch (_context4.prev = _context4.next) {
            case 0:
              socket = _ref3.socket, event = _ref3.event;
              if (!(event !== "down")) {
                _context4.next = 3;
                break;
              }
              return _context4.abrupt("return");
            case 3:
              if (!(socket.side === "input")) {
                _context4.next = 11;
                break;
              }
              _connection = context.editor.getConnections().find(function(item) {
                return item.target === socket.nodeId && item.targetInput === socket.key;
              });
              if (!_connection) {
                _context4.next = 11;
                break;
              }
              state = new PickedExisting(_connection, this.params, context);
              _context4.next = 9;
              return state.init(context);
            case 9:
              this.context.switchTo(state);
              return _context4.abrupt("return");
            case 11:
              _context4.next = 13;
              return context.scope.emit({
                type: "connectionpick",
                data: {
                  socket
                }
              });
            case 13:
              if (!_context4.sent) {
                _context4.next = 17;
                break;
              }
              this.context.switchTo(new Picked(socket, this.params));
              _context4.next = 18;
              break;
            case 17:
              this.drop(context);
            case 18:
            case "end":
              return _context4.stop();
          }
        }, _callee4, this);
      }));
      function pick(_x6, _x7) {
        return _pick3.apply(this, arguments);
      }
      return pick;
    })()
  }, {
    key: "drop",
    value: function drop(context) {
      var socket = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : null;
      var created = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : false;
      if (this.initial) {
        void context.scope.emit({
          type: "connectiondrop",
          data: {
            initial: this.initial,
            socket,
            created
          }
        });
      }
      delete this.initial;
    }
  }]);
})(State);
var ClassicFlow = (function() {
  function ClassicFlow2(params) {
    _classCallCheck(this, ClassicFlow2);
    var canMakeConnection$1 = (params === null || params === void 0 ? void 0 : params.canMakeConnection) || canMakeConnection;
    var makeConnection$1 = (params === null || params === void 0 ? void 0 : params.makeConnection) || makeConnection;
    this.switchTo(new Idle({
      canMakeConnection: canMakeConnection$1,
      makeConnection: makeConnection$1
    }));
  }
  return _createClass(ClassicFlow2, [{
    key: "pick",
    value: (function() {
      var _pick4 = _asyncToGenerator(import_regenerator.default.mark(function _callee5(params, context) {
        return import_regenerator.default.wrap(function _callee5$(_context5) {
          while (1) switch (_context5.prev = _context5.next) {
            case 0:
              _context5.next = 2;
              return this.currentState.pick(params, context);
            case 2:
            case "end":
              return _context5.stop();
          }
        }, _callee5, this);
      }));
      function pick(_x8, _x9) {
        return _pick4.apply(this, arguments);
      }
      return pick;
    })()
  }, {
    key: "getPickedSocket",
    value: function getPickedSocket() {
      return this.currentState.initial;
    }
  }, {
    key: "switchTo",
    value: function switchTo(state) {
      state.setContext(this);
      this.currentState = state;
    }
  }, {
    key: "drop",
    value: function drop(context) {
      this.currentState.drop(context);
    }
  }]);
})();
function setup() {
  return function() {
    return new ClassicFlow();
  };
}
var classic = Object.freeze({
  __proto__: null,
  setup
});
var index = Object.freeze({
  __proto__: null,
  classic
});
function _createForOfIteratorHelper(r, e) {
  var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
  if (!t) {
    if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) {
      t && (r = t);
      var _n = 0, F = function F2() {
      };
      return { s: F, n: function n() {
        return _n >= r.length ? { done: true } : { done: false, value: r[_n++] };
      }, e: function e2(r2) {
        throw r2;
      }, f: F };
    }
    throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
  }
  var o, a = true, u = false;
  return { s: function s() {
    t = t.call(r);
  }, n: function n() {
    var r2 = t.next();
    return a = r2.done, r2;
  }, e: function e2(r2) {
    u = true, o = r2;
  }, f: function f() {
    try {
      a || null == t["return"] || t["return"]();
    } finally {
      if (u) throw o;
    }
  } };
}
function _unsupportedIterableToArray(r, a) {
  if (r) {
    if ("string" == typeof r) return _arrayLikeToArray(r, a);
    var t = {}.toString.call(r).slice(8, -1);
    return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
  }
}
function _arrayLikeToArray(r, a) {
  (null == a || a > r.length) && (a = r.length);
  for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
  return n;
}
function _callSuper(t, o, e) {
  return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e));
}
function _isNativeReflectConstruct() {
  try {
    var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {
    }));
  } catch (t2) {
  }
  return (_isNativeReflectConstruct = function _isNativeReflectConstruct2() {
    return !!t;
  })();
}
function _superPropGet(t, e, o, r) {
  var p = _get(_getPrototypeOf(1 & r ? t.prototype : t), e, o);
  return 2 & r && "function" == typeof p ? function(t2) {
    return p.apply(o, t2);
  } : p;
}
var ConnectionPlugin = (function(_Scope) {
  function ConnectionPlugin2() {
    var _this;
    _classCallCheck(this, ConnectionPlugin2);
    _this = _callSuper(this, ConnectionPlugin2, ["connection"]);
    _defineProperty(_this, "presets", []);
    _defineProperty(_this, "currentFlow", null);
    _defineProperty(_this, "preudoconnection", createPseudoconnection({
      isPseudo: true
    }));
    _defineProperty(_this, "socketsCache", /* @__PURE__ */ new Map());
    return _this;
  }
  _inherits(ConnectionPlugin2, _Scope);
  return _createClass(ConnectionPlugin2, [{
    key: "addPreset",
    value: function addPreset(preset) {
      this.presets.push(preset);
    }
  }, {
    key: "findPreset",
    value: function findPreset(data) {
      var _iterator = _createForOfIteratorHelper(this.presets), _step;
      try {
        for (_iterator.s(); !(_step = _iterator.n()).done; ) {
          var preset = _step.value;
          var flow = preset(data);
          if (flow) return flow;
        }
      } catch (err) {
        _iterator.e(err);
      } finally {
        _iterator.f();
      }
      return null;
    }
  }, {
    key: "update",
    value: function update() {
      if (!this.currentFlow) return;
      var socket = this.currentFlow.getPickedSocket();
      if (socket) {
        this.preudoconnection.render(this.areaPlugin, this.areaPlugin.area.pointer, socket);
      }
    }
    /**
     * Drop pseudo-connection if exists
     * @emits connectiondrop
     */
  }, {
    key: "drop",
    value: function drop() {
      var flowContext = {
        editor: this.editor,
        scope: this,
        socketsCache: this.socketsCache
      };
      if (this.currentFlow) {
        this.currentFlow.drop(flowContext);
        this.preudoconnection.unmount(this.areaPlugin);
        this.currentFlow = null;
      }
    }
    // eslint-disable-next-line max-statements
  }, {
    key: "pick",
    value: (function() {
      var _pick = _asyncToGenerator(import_regenerator.default.mark(function _callee(event, type) {
        var flowContext, pointedElements, pickedSocket;
        return import_regenerator.default.wrap(function _callee$(_context) {
          while (1) switch (_context.prev = _context.next) {
            case 0:
              flowContext = {
                editor: this.editor,
                scope: this,
                socketsCache: this.socketsCache
              };
              pointedElements = elementsFromPoint(event.clientX, event.clientY);
              pickedSocket = findSocket(this.socketsCache, pointedElements);
              if (!pickedSocket) {
                _context.next = 13;
                break;
              }
              event.preventDefault();
              event.stopPropagation();
              this.currentFlow = this.currentFlow || this.findPreset(pickedSocket);
              if (!this.currentFlow) {
                _context.next = 11;
                break;
              }
              _context.next = 10;
              return this.currentFlow.pick({
                socket: pickedSocket,
                event: type
              }, flowContext);
            case 10:
              this.preudoconnection.mount(this.areaPlugin);
            case 11:
              _context.next = 14;
              break;
            case 13:
              if (this.currentFlow) {
                this.currentFlow.drop(flowContext);
              }
            case 14:
              if (this.currentFlow && !this.currentFlow.getPickedSocket()) {
                this.preudoconnection.unmount(this.areaPlugin);
                this.currentFlow = null;
              }
              this.update();
            case 16:
            case "end":
              return _context.stop();
          }
        }, _callee, this);
      }));
      function pick(_x, _x2) {
        return _pick.apply(this, arguments);
      }
      return pick;
    })()
  }, {
    key: "setParent",
    value: function setParent(scope) {
      var _this2 = this;
      _superPropGet(ConnectionPlugin2, "setParent", this, 3)([scope]);
      this.areaPlugin = this.parentScope(BaseAreaPlugin);
      this.editor = this.areaPlugin.parentScope(NodeEditor);
      var pointerdownSocket = function pointerdownSocket2(e) {
        void _this2.pick(e, "down");
      };
      this.addPipe(function(context) {
        if (!context || _typeof(context) !== "object" || !("type" in context)) return context;
        if (context.type === "pointermove") {
          _this2.update();
        } else if (context.type === "pointerup") {
          void _this2.pick(context.data.event, "up");
        } else if (context.type === "render") {
          if (context.data.type === "socket") {
            var element = context.data.element;
            element.addEventListener("pointerdown", pointerdownSocket);
            _this2.socketsCache.set(element, context.data);
          }
        } else if (context.type === "unmount") {
          var _element = context.data.element;
          _element.removeEventListener("pointerdown", pointerdownSocket);
          _this2.socketsCache["delete"](_element);
        }
        return context;
      });
    }
  }]);
})(Scope);
export {
  BidirectFlow,
  ClassicFlow,
  ConnectionPlugin,
  Flow,
  index as Presets,
  State,
  canMakeConnection,
  createPseudoconnection,
  getSourceTarget,
  makeConnection
};
//# sourceMappingURL=rete-connection-plugin.js.map
