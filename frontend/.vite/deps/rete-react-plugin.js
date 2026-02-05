import {
  _get,
  _slicedToArray
} from "./chunk-7HAVDVRF.js";
import {
  BaseAreaPlugin,
  _toConsumableArray
} from "./chunk-KBNZICPF.js";
import {
  Scope,
  _asyncToGenerator,
  _classCallCheck,
  _createClass,
  _defineProperty,
  _getPrototypeOf,
  _inherits,
  _possibleConstructorReturn,
  _typeof,
  classic,
  require_regenerator
} from "./chunk-EYN7YZXN.js";
import {
  require_react_dom
} from "./chunk-J45VAN7Q.js";
import {
  require_react
} from "./chunk-IGR7ZU6C.js";
import {
  __commonJS,
  __toESM
} from "./chunk-PLDDJCW6.js";

// node_modules/shallowequal/index.js
var require_shallowequal = __commonJS({
  "node_modules/shallowequal/index.js"(exports, module) {
    module.exports = function shallowEqual(objA, objB, compare, compareContext) {
      var ret = compare ? compare.call(compareContext, objA, objB) : void 0;
      if (ret !== void 0) {
        return !!ret;
      }
      if (objA === objB) {
        return true;
      }
      if (typeof objA !== "object" || !objA || typeof objB !== "object" || !objB) {
        return false;
      }
      var keysA = Object.keys(objA);
      var keysB = Object.keys(objB);
      if (keysA.length !== keysB.length) {
        return false;
      }
      var bHasOwnProperty = Object.prototype.hasOwnProperty.bind(objB);
      for (var idx = 0; idx < keysA.length; idx++) {
        var key = keysA[idx];
        if (!bHasOwnProperty(key)) {
          return false;
        }
        var valueA = objA[key];
        var valueB = objB[key];
        ret = compare ? compare.call(compareContext, valueA, valueB, key) : void 0;
        if (ret === false || ret === void 0 && valueA !== valueB) {
          return false;
        }
      }
      return true;
    };
  }
});

// node_modules/rete-react-plugin/rete-react-plugin.esm.js
var React = __toESM(require_react());
var import_react2 = __toESM(require_react());
var ReactDOM = __toESM(require_react_dom());
var import_react_dom = __toESM(require_react_dom());
var import_regenerator2 = __toESM(require_regenerator());

// node_modules/rete-render-utils/rete-render-utils.esm.js
var import_regenerator = __toESM(require_regenerator());
function classicConnectionPath(points, curvature) {
  var _points = _slicedToArray(points, 2), _points$ = _points[0], x1 = _points$.x, y1 = _points$.y, _points$2 = _points[1], x2 = _points$2.x, y2 = _points$2.y;
  var vertical = Math.abs(y1 - y2);
  var hx1 = x1 + Math.max(vertical / 2, Math.abs(x2 - x1)) * curvature;
  var hx2 = x2 - Math.max(vertical / 2, Math.abs(x2 - x1)) * curvature;
  return "M ".concat(x1, " ").concat(y1, " C ").concat(hx1, " ").concat(y1, " ").concat(hx2, " ").concat(y2, " ").concat(x2, " ").concat(y2);
}
function loopConnectionPath(points, curvature, size) {
  var _points2 = _slicedToArray(points, 2), _points2$ = _points2[0], x1 = _points2$.x, y1 = _points2$.y, _points2$2 = _points2[1], x2 = _points2$2.x, y2 = _points2$2.y;
  var k2 = y2 > y1 ? 1 : -1;
  var scale = size + Math.abs(x1 - x2) / (size / 2);
  var middleX = (x1 + x2) / 2;
  var middleY = y1 - k2 * scale;
  var vertical = (y2 - y1) * curvature;
  return "\n        M ".concat(x1, " ").concat(y1, "\n        C ").concat(x1 + scale, " ").concat(y1, "\n        ").concat(x1 + scale, " ").concat(middleY - vertical, "\n        ").concat(middleX, " ").concat(middleY, "\n        C ").concat(x2 - scale, " ").concat(middleY + vertical, "\n        ").concat(x2 - scale, " ").concat(y2, "\n        ").concat(x2, " ").concat(y2, "\n    ");
}
function getElementCenter(_x, _x2) {
  return _getElementCenter.apply(this, arguments);
}
function _getElementCenter() {
  _getElementCenter = _asyncToGenerator(import_regenerator.default.mark(function _callee(child, parent) {
    var x2, y2, currentElement, width, height;
    return import_regenerator.default.wrap(function _callee$(_context) {
      while (1) switch (_context.prev = _context.next) {
        case 0:
          if (child.offsetParent) {
            _context.next = 5;
            break;
          }
          _context.next = 3;
          return new Promise(function(res) {
            return setTimeout(res, 0);
          });
        case 3:
          _context.next = 0;
          break;
        case 5:
          x2 = child.offsetLeft;
          y2 = child.offsetTop;
          currentElement = child.offsetParent;
          if (currentElement) {
            _context.next = 10;
            break;
          }
          throw new Error("child has null offsetParent");
        case 10:
          while (currentElement !== null && currentElement !== parent) {
            x2 += currentElement.offsetLeft + currentElement.clientLeft;
            y2 += currentElement.offsetTop + currentElement.clientTop;
            currentElement = currentElement.offsetParent;
          }
          width = child.offsetWidth;
          height = child.offsetHeight;
          return _context.abrupt("return", {
            x: x2 + width / 2,
            y: y2 + height / 2
          });
        case 14:
        case "end":
          return _context.stop();
      }
    }, _callee);
  }));
  return _getElementCenter.apply(this, arguments);
}
var EventEmitter = (function() {
  function EventEmitter2() {
    _classCallCheck(this, EventEmitter2);
    _defineProperty(this, "listeners", /* @__PURE__ */ new Set());
  }
  return _createClass(EventEmitter2, [{
    key: "emit",
    value: function emit(data) {
      this.listeners.forEach(function(listener) {
        listener(data);
      });
    }
  }, {
    key: "listen",
    value: function listen(handler) {
      var _this = this;
      this.listeners.add(handler);
      return function() {
        _this.listeners["delete"](handler);
      };
    }
  }]);
})();
var SocketsPositionsStorage = (function() {
  function SocketsPositionsStorage2() {
    _classCallCheck(this, SocketsPositionsStorage2);
    _defineProperty(this, "elements", /* @__PURE__ */ new Map());
  }
  return _createClass(SocketsPositionsStorage2, [{
    key: "getPosition",
    value: function getPosition(data) {
      var _found$pop$position, _found$pop;
      var list = Array.from(this.elements.values()).flat();
      var found = list.filter(function(item) {
        return item.side === data.side && item.nodeId === data.nodeId && item.key === data.key;
      });
      if (found.length > 1) console.warn(["Found more than one element for socket with same key and side.", "Probably it was not unmounted correctly"].join(" "), data);
      return (_found$pop$position = (_found$pop = found.pop()) === null || _found$pop === void 0 ? void 0 : _found$pop.position) !== null && _found$pop$position !== void 0 ? _found$pop$position : null;
    }
  }, {
    key: "add",
    value: function add(data) {
      var existing = this.elements.get(data.element);
      this.elements.set(data.element, existing ? [].concat(_toConsumableArray(existing.filter(function(n) {
        return !(n.nodeId === data.nodeId && n.key === data.key && n.side === data.side);
      })), [data]) : [data]);
    }
  }, {
    key: "remove",
    value: function remove(element) {
      this.elements["delete"](element);
    }
  }, {
    key: "snapshot",
    value: function snapshot() {
      return Array.from(this.elements.values()).flat();
    }
  }]);
})();
var BaseSocketPosition = (function() {
  function BaseSocketPosition2() {
    _classCallCheck(this, BaseSocketPosition2);
    _defineProperty(this, "sockets", new SocketsPositionsStorage());
    _defineProperty(this, "emitter", new EventEmitter());
    _defineProperty(this, "area", null);
  }
  return _createClass(BaseSocketPosition2, [{
    key: "attach",
    value: (
      /**
       * Attach the watcher to the area's child scope.
       * @param scope Scope of the watcher that should be a child of `BaseAreaPlugin`
       */
      function attach(scope) {
        var _this = this;
        if (this.area) return;
        if (!scope.hasParent()) return;
        this.area = scope.parentScope(BaseAreaPlugin);
        this.area.addPipe((function() {
          var _ref = _asyncToGenerator(import_regenerator.default.mark(function _callee2(context) {
            var _context$data, _nodeId, _key, _side, _element, position2, _nodeId2, _context$data$payload, source, target, _nodeId3;
            return import_regenerator.default.wrap(function _callee2$(_context2) {
              while (1) switch (_context2.prev = _context2.next) {
                case 0:
                  if (!(context.type === "rendered" && context.data.type === "socket")) {
                    _context2.next = 8;
                    break;
                  }
                  _context$data = context.data, _nodeId = _context$data.nodeId, _key = _context$data.key, _side = _context$data.side, _element = _context$data.element;
                  _context2.next = 4;
                  return _this.calculatePosition(_nodeId, _side, _key, _element);
                case 4:
                  position2 = _context2.sent;
                  if (position2) {
                    _this.sockets.add({
                      nodeId: _nodeId,
                      key: _key,
                      side: _side,
                      element: _element,
                      position: position2
                    });
                    _this.emitter.emit({
                      nodeId: _nodeId,
                      key: _key,
                      side: _side
                    });
                  }
                  _context2.next = 24;
                  break;
                case 8:
                  if (!(context.type === "unmount")) {
                    _context2.next = 12;
                    break;
                  }
                  _this.sockets.remove(context.data.element);
                  _context2.next = 24;
                  break;
                case 12:
                  if (!(context.type === "nodetranslated")) {
                    _context2.next = 16;
                    break;
                  }
                  _this.emitter.emit({
                    nodeId: context.data.id
                  });
                  _context2.next = 24;
                  break;
                case 16:
                  if (!(context.type === "noderesized")) {
                    _context2.next = 23;
                    break;
                  }
                  _nodeId2 = context.data.id;
                  _context2.next = 20;
                  return Promise.all(_this.sockets.snapshot().filter(function(item) {
                    return item.nodeId === context.data.id && item.side === "output";
                  }).map((function() {
                    var _ref2 = _asyncToGenerator(import_regenerator.default.mark(function _callee(item) {
                      var side, key, element, position3;
                      return import_regenerator.default.wrap(function _callee$(_context) {
                        while (1) switch (_context.prev = _context.next) {
                          case 0:
                            side = item.side, key = item.key, element = item.element;
                            _context.next = 3;
                            return _this.calculatePosition(_nodeId2, side, key, element);
                          case 3:
                            position3 = _context.sent;
                            if (position3) {
                              item.position = position3;
                            }
                          case 5:
                          case "end":
                            return _context.stop();
                        }
                      }, _callee);
                    }));
                    return function(_x2) {
                      return _ref2.apply(this, arguments);
                    };
                  })()));
                case 20:
                  _this.emitter.emit({
                    nodeId: _nodeId2
                  });
                  _context2.next = 24;
                  break;
                case 23:
                  if (context.type === "render" && context.data.type === "connection") {
                    _context$data$payload = context.data.payload, source = _context$data$payload.source, target = _context$data$payload.target;
                    _nodeId3 = source || target;
                    _this.emitter.emit({
                      nodeId: _nodeId3
                    });
                  }
                case 24:
                  return _context2.abrupt("return", context);
                case 25:
                case "end":
                  return _context2.stop();
              }
            }, _callee2);
          }));
          return function(_x) {
            return _ref.apply(this, arguments);
          };
        })());
      }
    )
    /**
     * Listen to socket position changes. Usually used by rendering plugins to update the start/end of the connection.
     * @internal
     * @param nodeId Node ID
     * @param side Side of the socket, 'input' or 'output'
     * @param key Socket key
     * @param change Callback function that is called when the socket position changes
     */
  }, {
    key: "listen",
    value: function listen(nodeId, side, key, change) {
      var _this2 = this;
      var unlisten = this.emitter.listen(function(data) {
        if (data.nodeId !== nodeId) return;
        if ((!data.key || data.side === side) && (!data.side || data.key === key)) {
          var _this2$area;
          var position2 = _this2.sockets.getPosition({
            side,
            nodeId,
            key
          });
          if (!position2) return;
          var x2 = position2.x, y2 = position2.y;
          var nodeView = (_this2$area = _this2.area) === null || _this2$area === void 0 ? void 0 : _this2$area.nodeViews.get(nodeId);
          if (nodeView) change({
            x: x2 + nodeView.position.x,
            y: y2 + nodeView.position.y
          });
        }
      });
      this.sockets.snapshot().forEach(function(data) {
        if (data.nodeId === nodeId) _this2.emitter.emit(data);
      });
      return unlisten;
    }
  }]);
})();
function _callSuper(t, o2, e) {
  return o2 = _getPrototypeOf(o2), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o2, e || [], _getPrototypeOf(t).constructor) : o2.apply(t, e));
}
function _isNativeReflectConstruct() {
  try {
    var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {
    }));
  } catch (t2) {
  }
  return (_isNativeReflectConstruct = function _isNativeReflectConstruct3() {
    return !!t;
  })();
}
var DOMSocketPosition = (function(_BaseSocketPosition) {
  function DOMSocketPosition2(props) {
    var _this;
    _classCallCheck(this, DOMSocketPosition2);
    _this = _callSuper(this, DOMSocketPosition2);
    _this.props = props;
    return _this;
  }
  _inherits(DOMSocketPosition2, _BaseSocketPosition);
  return _createClass(DOMSocketPosition2, [{
    key: "calculatePosition",
    value: (function() {
      var _calculatePosition = _asyncToGenerator(import_regenerator.default.mark(function _callee(nodeId, side, key, element) {
        var _this$area, _this$props;
        var view, position2;
        return import_regenerator.default.wrap(function _callee$(_context) {
          while (1) switch (_context.prev = _context.next) {
            case 0:
              view = (_this$area = this.area) === null || _this$area === void 0 ? void 0 : _this$area.nodeViews.get(nodeId);
              if (view !== null && view !== void 0 && view.element) {
                _context.next = 3;
                break;
              }
              return _context.abrupt("return", null);
            case 3:
              _context.next = 5;
              return getElementCenter(element, view.element);
            case 5:
              position2 = _context.sent;
              if (!((_this$props = this.props) !== null && _this$props !== void 0 && _this$props.offset)) {
                _context.next = 8;
                break;
              }
              return _context.abrupt("return", this.props.offset(position2, nodeId, side, key));
            case 8:
              return _context.abrupt("return", {
                x: position2.x + 12 * (side === "input" ? -1 : 1),
                y: position2.y
              });
            case 9:
            case "end":
              return _context.stop();
          }
        }, _callee, this);
      }));
      function calculatePosition(_x, _x2, _x3, _x4) {
        return _calculatePosition.apply(this, arguments);
      }
      return calculatePosition;
    })()
  }]);
})(BaseSocketPosition);
function getDOMSocketPosition(props) {
  return new DOMSocketPosition(props);
}

// node_modules/@babel/runtime/helpers/esm/taggedTemplateLiteral.js
function _taggedTemplateLiteral(e, t) {
  return t || (t = e.slice(0)), Object.freeze(Object.defineProperties(e, {
    raw: {
      value: Object.freeze(t)
    }
  }));
}

// node_modules/tslib/tslib.es6.mjs
var __assign = function() {
  __assign = Object.assign || function __assign2(t) {
    for (var s2, i2 = 1, n = arguments.length; i2 < n; i2++) {
      s2 = arguments[i2];
      for (var p2 in s2) if (Object.prototype.hasOwnProperty.call(s2, p2)) t[p2] = s2[p2];
    }
    return t;
  };
  return __assign.apply(this, arguments);
};
function __spreadArray(to, from2, pack) {
  if (pack || arguments.length === 2) for (var i2 = 0, l2 = from2.length, ar; i2 < l2; i2++) {
    if (ar || !(i2 in from2)) {
      if (!ar) ar = Array.prototype.slice.call(from2, 0, i2);
      ar[i2] = from2[i2];
    }
  }
  return to.concat(ar || Array.prototype.slice.call(from2));
}

// node_modules/@emotion/memoize/dist/emotion-memoize.esm.js
function memoize(fn) {
  var cache = /* @__PURE__ */ Object.create(null);
  return function(arg) {
    if (cache[arg] === void 0) cache[arg] = fn(arg);
    return cache[arg];
  };
}

// node_modules/@emotion/is-prop-valid/dist/emotion-is-prop-valid.esm.js
var reactPropsRegex = /^((children|dangerouslySetInnerHTML|key|ref|autoFocus|defaultValue|defaultChecked|innerHTML|suppressContentEditableWarning|suppressHydrationWarning|valueLink|abbr|accept|acceptCharset|accessKey|action|allow|allowUserMedia|allowPaymentRequest|allowFullScreen|allowTransparency|alt|async|autoComplete|autoPlay|capture|cellPadding|cellSpacing|challenge|charSet|checked|cite|classID|className|cols|colSpan|content|contentEditable|contextMenu|controls|controlsList|coords|crossOrigin|data|dateTime|decoding|default|defer|dir|disabled|disablePictureInPicture|disableRemotePlayback|download|draggable|encType|enterKeyHint|form|formAction|formEncType|formMethod|formNoValidate|formTarget|frameBorder|headers|height|hidden|high|href|hrefLang|htmlFor|httpEquiv|id|inputMode|integrity|is|keyParams|keyType|kind|label|lang|list|loading|loop|low|marginHeight|marginWidth|max|maxLength|media|mediaGroup|method|min|minLength|multiple|muted|name|nonce|noValidate|open|optimum|pattern|placeholder|playsInline|poster|preload|profile|radioGroup|readOnly|referrerPolicy|rel|required|reversed|role|rows|rowSpan|sandbox|scope|scoped|scrolling|seamless|selected|shape|size|sizes|slot|span|spellCheck|src|srcDoc|srcLang|srcSet|start|step|style|summary|tabIndex|target|title|translate|type|useMap|value|width|wmode|wrap|about|datatype|inlist|prefix|property|resource|typeof|vocab|autoCapitalize|autoCorrect|autoSave|color|incremental|fallback|inert|itemProp|itemScope|itemType|itemID|itemRef|on|option|results|security|unselectable|accentHeight|accumulate|additive|alignmentBaseline|allowReorder|alphabetic|amplitude|arabicForm|ascent|attributeName|attributeType|autoReverse|azimuth|baseFrequency|baselineShift|baseProfile|bbox|begin|bias|by|calcMode|capHeight|clip|clipPathUnits|clipPath|clipRule|colorInterpolation|colorInterpolationFilters|colorProfile|colorRendering|contentScriptType|contentStyleType|cursor|cx|cy|d|decelerate|descent|diffuseConstant|direction|display|divisor|dominantBaseline|dur|dx|dy|edgeMode|elevation|enableBackground|end|exponent|externalResourcesRequired|fill|fillOpacity|fillRule|filter|filterRes|filterUnits|floodColor|floodOpacity|focusable|fontFamily|fontSize|fontSizeAdjust|fontStretch|fontStyle|fontVariant|fontWeight|format|from|fr|fx|fy|g1|g2|glyphName|glyphOrientationHorizontal|glyphOrientationVertical|glyphRef|gradientTransform|gradientUnits|hanging|horizAdvX|horizOriginX|ideographic|imageRendering|in|in2|intercept|k|k1|k2|k3|k4|kernelMatrix|kernelUnitLength|kerning|keyPoints|keySplines|keyTimes|lengthAdjust|letterSpacing|lightingColor|limitingConeAngle|local|markerEnd|markerMid|markerStart|markerHeight|markerUnits|markerWidth|mask|maskContentUnits|maskUnits|mathematical|mode|numOctaves|offset|opacity|operator|order|orient|orientation|origin|overflow|overlinePosition|overlineThickness|panose1|paintOrder|pathLength|patternContentUnits|patternTransform|patternUnits|pointerEvents|points|pointsAtX|pointsAtY|pointsAtZ|preserveAlpha|preserveAspectRatio|primitiveUnits|r|radius|refX|refY|renderingIntent|repeatCount|repeatDur|requiredExtensions|requiredFeatures|restart|result|rotate|rx|ry|scale|seed|shapeRendering|slope|spacing|specularConstant|specularExponent|speed|spreadMethod|startOffset|stdDeviation|stemh|stemv|stitchTiles|stopColor|stopOpacity|strikethroughPosition|strikethroughThickness|string|stroke|strokeDasharray|strokeDashoffset|strokeLinecap|strokeLinejoin|strokeMiterlimit|strokeOpacity|strokeWidth|surfaceScale|systemLanguage|tableValues|targetX|targetY|textAnchor|textDecoration|textRendering|textLength|to|transform|u1|u2|underlinePosition|underlineThickness|unicode|unicodeBidi|unicodeRange|unitsPerEm|vAlphabetic|vHanging|vIdeographic|vMathematical|values|vectorEffect|version|vertAdvY|vertOriginX|vertOriginY|viewBox|viewTarget|visibility|widths|wordSpacing|writingMode|x|xHeight|x1|x2|xChannelSelector|xlinkActuate|xlinkArcrole|xlinkHref|xlinkRole|xlinkShow|xlinkTitle|xlinkType|xmlBase|xmlns|xmlnsXlink|xmlLang|xmlSpace|y|y1|y2|yChannelSelector|z|zoomAndPan|for|class|autofocus)|(([Dd][Aa][Tt][Aa]|[Aa][Rr][Ii][Aa]|x)-.*))$/;
var isPropValid = memoize(
  function(prop) {
    return reactPropsRegex.test(prop) || prop.charCodeAt(0) === 111 && prop.charCodeAt(1) === 110 && prop.charCodeAt(2) < 91;
  }
  /* Z+1 */
);

// node_modules/styled-components/dist/styled-components.browser.esm.js
var import_react = __toESM(require_react());
var import_shallowequal = __toESM(require_shallowequal());

// node_modules/stylis/src/Enum.js
var MS = "-ms-";
var MOZ = "-moz-";
var WEBKIT = "-webkit-";
var COMMENT = "comm";
var RULESET = "rule";
var DECLARATION = "decl";
var IMPORT = "@import";
var KEYFRAMES = "@keyframes";
var LAYER = "@layer";

// node_modules/stylis/src/Utility.js
var abs = Math.abs;
var from = String.fromCharCode;
var assign = Object.assign;
function hash(value, length2) {
  return charat(value, 0) ^ 45 ? (((length2 << 2 ^ charat(value, 0)) << 2 ^ charat(value, 1)) << 2 ^ charat(value, 2)) << 2 ^ charat(value, 3) : 0;
}
function trim(value) {
  return value.trim();
}
function match(value, pattern) {
  return (value = pattern.exec(value)) ? value[0] : value;
}
function replace(value, pattern, replacement) {
  return value.replace(pattern, replacement);
}
function indexof(value, search, position2) {
  return value.indexOf(search, position2);
}
function charat(value, index2) {
  return value.charCodeAt(index2) | 0;
}
function substr(value, begin, end) {
  return value.slice(begin, end);
}
function strlen(value) {
  return value.length;
}
function sizeof(value) {
  return value.length;
}
function append(value, array) {
  return array.push(value), value;
}
function combine(array, callback) {
  return array.map(callback).join("");
}
function filter(array, pattern) {
  return array.filter(function(value) {
    return !match(value, pattern);
  });
}

// node_modules/stylis/src/Tokenizer.js
var line = 1;
var column = 1;
var length = 0;
var position = 0;
var character = 0;
var characters = "";
function node(value, root, parent, type, props, children, length2, siblings) {
  return { value, root, parent, type, props, children, line, column, length: length2, return: "", siblings };
}
function copy(root, props) {
  return assign(node("", null, null, "", null, null, 0, root.siblings), root, { length: -root.length }, props);
}
function lift(root) {
  while (root.root)
    root = copy(root.root, { children: [root] });
  append(root, root.siblings);
}
function char() {
  return character;
}
function prev() {
  character = position > 0 ? charat(characters, --position) : 0;
  if (column--, character === 10)
    column = 1, line--;
  return character;
}
function next() {
  character = position < length ? charat(characters, position++) : 0;
  if (column++, character === 10)
    column = 1, line++;
  return character;
}
function peek() {
  return charat(characters, position);
}
function caret() {
  return position;
}
function slice(begin, end) {
  return substr(characters, begin, end);
}
function token(type) {
  switch (type) {
    // \0 \t \n \r \s whitespace token
    case 0:
    case 9:
    case 10:
    case 13:
    case 32:
      return 5;
    // ! + , / > @ ~ isolate token
    case 33:
    case 43:
    case 44:
    case 47:
    case 62:
    case 64:
    case 126:
    // ; { } breakpoint token
    case 59:
    case 123:
    case 125:
      return 4;
    // : accompanied token
    case 58:
      return 3;
    // " ' ( [ opening delimit token
    case 34:
    case 39:
    case 40:
    case 91:
      return 2;
    // ) ] closing delimit token
    case 41:
    case 93:
      return 1;
  }
  return 0;
}
function alloc(value) {
  return line = column = 1, length = strlen(characters = value), position = 0, [];
}
function dealloc(value) {
  return characters = "", value;
}
function delimit(type) {
  return trim(slice(position - 1, delimiter(type === 91 ? type + 2 : type === 40 ? type + 1 : type)));
}
function whitespace(type) {
  while (character = peek())
    if (character < 33)
      next();
    else
      break;
  return token(type) > 2 || token(character) > 3 ? "" : " ";
}
function escaping(index2, count) {
  while (--count && next())
    if (character < 48 || character > 102 || character > 57 && character < 65 || character > 70 && character < 97)
      break;
  return slice(index2, caret() + (count < 6 && peek() == 32 && next() == 32));
}
function delimiter(type) {
  while (next())
    switch (character) {
      // ] ) " '
      case type:
        return position;
      // " '
      case 34:
      case 39:
        if (type !== 34 && type !== 39)
          delimiter(character);
        break;
      // (
      case 40:
        if (type === 41)
          delimiter(type);
        break;
      // \
      case 92:
        next();
        break;
    }
  return position;
}
function commenter(type, index2) {
  while (next())
    if (type + character === 47 + 10)
      break;
    else if (type + character === 42 + 42 && peek() === 47)
      break;
  return "/*" + slice(index2, position - 1) + "*" + from(type === 47 ? type : next());
}
function identifier(index2) {
  while (!token(peek()))
    next();
  return slice(index2, position);
}

// node_modules/stylis/src/Parser.js
function compile(value) {
  return dealloc(parse("", null, null, null, [""], value = alloc(value), 0, [0], value));
}
function parse(value, root, parent, rule, rules, rulesets, pseudo, points, declarations) {
  var index2 = 0;
  var offset = 0;
  var length2 = pseudo;
  var atrule = 0;
  var property = 0;
  var previous = 0;
  var variable = 1;
  var scanning = 1;
  var ampersand = 1;
  var character2 = 0;
  var type = "";
  var props = rules;
  var children = rulesets;
  var reference = rule;
  var characters2 = type;
  while (scanning)
    switch (previous = character2, character2 = next()) {
      // (
      case 40:
        if (previous != 108 && charat(characters2, length2 - 1) == 58) {
          if (indexof(characters2 += replace(delimit(character2), "&", "&\f"), "&\f", abs(index2 ? points[index2 - 1] : 0)) != -1)
            ampersand = -1;
          break;
        }
      // " ' [
      case 34:
      case 39:
      case 91:
        characters2 += delimit(character2);
        break;
      // \t \n \r \s
      case 9:
      case 10:
      case 13:
      case 32:
        characters2 += whitespace(previous);
        break;
      // \
      case 92:
        characters2 += escaping(caret() - 1, 7);
        continue;
      // /
      case 47:
        switch (peek()) {
          case 42:
          case 47:
            append(comment(commenter(next(), caret()), root, parent, declarations), declarations);
            break;
          default:
            characters2 += "/";
        }
        break;
      // {
      case 123 * variable:
        points[index2++] = strlen(characters2) * ampersand;
      // } ; \0
      case 125 * variable:
      case 59:
      case 0:
        switch (character2) {
          // \0 }
          case 0:
          case 125:
            scanning = 0;
          // ;
          case 59 + offset:
            if (ampersand == -1) characters2 = replace(characters2, /\f/g, "");
            if (property > 0 && strlen(characters2) - length2)
              append(property > 32 ? declaration(characters2 + ";", rule, parent, length2 - 1, declarations) : declaration(replace(characters2, " ", "") + ";", rule, parent, length2 - 2, declarations), declarations);
            break;
          // @ ;
          case 59:
            characters2 += ";";
          // { rule/at-rule
          default:
            append(reference = ruleset(characters2, root, parent, index2, offset, rules, points, type, props = [], children = [], length2, rulesets), rulesets);
            if (character2 === 123)
              if (offset === 0)
                parse(characters2, root, reference, reference, props, rulesets, length2, points, children);
              else
                switch (atrule === 99 && charat(characters2, 3) === 110 ? 100 : atrule) {
                  // d l m s
                  case 100:
                  case 108:
                  case 109:
                  case 115:
                    parse(value, reference, reference, rule && append(ruleset(value, reference, reference, 0, 0, rules, points, type, rules, props = [], length2, children), children), rules, children, length2, points, rule ? props : children);
                    break;
                  default:
                    parse(characters2, reference, reference, reference, [""], children, 0, points, children);
                }
        }
        index2 = offset = property = 0, variable = ampersand = 1, type = characters2 = "", length2 = pseudo;
        break;
      // :
      case 58:
        length2 = 1 + strlen(characters2), property = previous;
      default:
        if (variable < 1) {
          if (character2 == 123)
            --variable;
          else if (character2 == 125 && variable++ == 0 && prev() == 125)
            continue;
        }
        switch (characters2 += from(character2), character2 * variable) {
          // &
          case 38:
            ampersand = offset > 0 ? 1 : (characters2 += "\f", -1);
            break;
          // ,
          case 44:
            points[index2++] = (strlen(characters2) - 1) * ampersand, ampersand = 1;
            break;
          // @
          case 64:
            if (peek() === 45)
              characters2 += delimit(next());
            atrule = peek(), offset = length2 = strlen(type = characters2 += identifier(caret())), character2++;
            break;
          // -
          case 45:
            if (previous === 45 && strlen(characters2) == 2)
              variable = 0;
        }
    }
  return rulesets;
}
function ruleset(value, root, parent, index2, offset, rules, points, type, props, children, length2, siblings) {
  var post = offset - 1;
  var rule = offset === 0 ? rules : [""];
  var size = sizeof(rule);
  for (var i2 = 0, j2 = 0, k2 = 0; i2 < index2; ++i2)
    for (var x2 = 0, y2 = substr(value, post + 1, post = abs(j2 = points[i2])), z2 = value; x2 < size; ++x2)
      if (z2 = trim(j2 > 0 ? rule[x2] + " " + y2 : replace(y2, /&\f/g, rule[x2])))
        props[k2++] = z2;
  return node(value, root, parent, offset === 0 ? RULESET : type, props, children, length2, siblings);
}
function comment(value, root, parent, siblings) {
  return node(value, root, parent, COMMENT, from(char()), substr(value, 2, -2), 0, siblings);
}
function declaration(value, root, parent, length2, siblings) {
  return node(value, root, parent, DECLARATION, substr(value, 0, length2), substr(value, length2 + 1, -1), length2, siblings);
}

// node_modules/stylis/src/Prefixer.js
function prefix(value, length2, children) {
  switch (hash(value, length2)) {
    // color-adjust
    case 5103:
      return WEBKIT + "print-" + value + value;
    // animation, animation-(delay|direction|duration|fill-mode|iteration-count|name|play-state|timing-function)
    case 5737:
    case 4201:
    case 3177:
    case 3433:
    case 1641:
    case 4457:
    case 2921:
    // text-decoration, filter, clip-path, backface-visibility, column, box-decoration-break
    case 5572:
    case 6356:
    case 5844:
    case 3191:
    case 6645:
    case 3005:
    // mask, mask-image, mask-(mode|clip|size), mask-(repeat|origin), mask-position, mask-composite,
    case 6391:
    case 5879:
    case 5623:
    case 6135:
    case 4599:
    case 4855:
    // background-clip, columns, column-(count|fill|gap|rule|rule-color|rule-style|rule-width|span|width)
    case 4215:
    case 6389:
    case 5109:
    case 5365:
    case 5621:
    case 3829:
      return WEBKIT + value + value;
    // tab-size
    case 4789:
      return MOZ + value + value;
    // appearance, user-select, transform, hyphens, text-size-adjust
    case 5349:
    case 4246:
    case 4810:
    case 6968:
    case 2756:
      return WEBKIT + value + MOZ + value + MS + value + value;
    // writing-mode
    case 5936:
      switch (charat(value, length2 + 11)) {
        // vertical-l(r)
        case 114:
          return WEBKIT + value + MS + replace(value, /[svh]\w+-[tblr]{2}/, "tb") + value;
        // vertical-r(l)
        case 108:
          return WEBKIT + value + MS + replace(value, /[svh]\w+-[tblr]{2}/, "tb-rl") + value;
        // horizontal(-)tb
        case 45:
          return WEBKIT + value + MS + replace(value, /[svh]\w+-[tblr]{2}/, "lr") + value;
      }
    // flex, flex-direction, scroll-snap-type, writing-mode
    case 6828:
    case 4268:
    case 2903:
      return WEBKIT + value + MS + value + value;
    // order
    case 6165:
      return WEBKIT + value + MS + "flex-" + value + value;
    // align-items
    case 5187:
      return WEBKIT + value + replace(value, /(\w+).+(:[^]+)/, WEBKIT + "box-$1$2" + MS + "flex-$1$2") + value;
    // align-self
    case 5443:
      return WEBKIT + value + MS + "flex-item-" + replace(value, /flex-|-self/g, "") + (!match(value, /flex-|baseline/) ? MS + "grid-row-" + replace(value, /flex-|-self/g, "") : "") + value;
    // align-content
    case 4675:
      return WEBKIT + value + MS + "flex-line-pack" + replace(value, /align-content|flex-|-self/g, "") + value;
    // flex-shrink
    case 5548:
      return WEBKIT + value + MS + replace(value, "shrink", "negative") + value;
    // flex-basis
    case 5292:
      return WEBKIT + value + MS + replace(value, "basis", "preferred-size") + value;
    // flex-grow
    case 6060:
      return WEBKIT + "box-" + replace(value, "-grow", "") + WEBKIT + value + MS + replace(value, "grow", "positive") + value;
    // transition
    case 4554:
      return WEBKIT + replace(value, /([^-])(transform)/g, "$1" + WEBKIT + "$2") + value;
    // cursor
    case 6187:
      return replace(replace(replace(value, /(zoom-|grab)/, WEBKIT + "$1"), /(image-set)/, WEBKIT + "$1"), value, "") + value;
    // background, background-image
    case 5495:
    case 3959:
      return replace(value, /(image-set\([^]*)/, WEBKIT + "$1$`$1");
    // justify-content
    case 4968:
      return replace(replace(value, /(.+:)(flex-)?(.*)/, WEBKIT + "box-pack:$3" + MS + "flex-pack:$3"), /s.+-b[^;]+/, "justify") + WEBKIT + value + value;
    // justify-self
    case 4200:
      if (!match(value, /flex-|baseline/)) return MS + "grid-column-align" + substr(value, length2) + value;
      break;
    // grid-template-(columns|rows)
    case 2592:
    case 3360:
      return MS + replace(value, "template-", "") + value;
    // grid-(row|column)-start
    case 4384:
    case 3616:
      if (children && children.some(function(element, index2) {
        return length2 = index2, match(element.props, /grid-\w+-end/);
      })) {
        return ~indexof(value + (children = children[length2].value), "span", 0) ? value : MS + replace(value, "-start", "") + value + MS + "grid-row-span:" + (~indexof(children, "span", 0) ? match(children, /\d+/) : +match(children, /\d+/) - +match(value, /\d+/)) + ";";
      }
      return MS + replace(value, "-start", "") + value;
    // grid-(row|column)-end
    case 4896:
    case 4128:
      return children && children.some(function(element) {
        return match(element.props, /grid-\w+-start/);
      }) ? value : MS + replace(replace(value, "-end", "-span"), "span ", "") + value;
    // (margin|padding)-inline-(start|end)
    case 4095:
    case 3583:
    case 4068:
    case 2532:
      return replace(value, /(.+)-inline(.+)/, WEBKIT + "$1$2") + value;
    // (min|max)?(width|height|inline-size|block-size)
    case 8116:
    case 7059:
    case 5753:
    case 5535:
    case 5445:
    case 5701:
    case 4933:
    case 4677:
    case 5533:
    case 5789:
    case 5021:
    case 4765:
      if (strlen(value) - 1 - length2 > 6)
        switch (charat(value, length2 + 1)) {
          // (m)ax-content, (m)in-content
          case 109:
            if (charat(value, length2 + 4) !== 45)
              break;
          // (f)ill-available, (f)it-content
          case 102:
            return replace(value, /(.+:)(.+)-([^]+)/, "$1" + WEBKIT + "$2-$3$1" + MOZ + (charat(value, length2 + 3) == 108 ? "$3" : "$2-$3")) + value;
          // (s)tretch
          case 115:
            return ~indexof(value, "stretch", 0) ? prefix(replace(value, "stretch", "fill-available"), length2, children) + value : value;
        }
      break;
    // grid-(column|row)
    case 5152:
    case 5920:
      return replace(value, /(.+?):(\d+)(\s*\/\s*(span)?\s*(\d+))?(.*)/, function(_2, a2, b, c2, d, e, f2) {
        return MS + a2 + ":" + b + f2 + (c2 ? MS + a2 + "-span:" + (d ? e : +e - +b) + f2 : "") + value;
      });
    // position: sticky
    case 4949:
      if (charat(value, length2 + 6) === 121)
        return replace(value, ":", ":" + WEBKIT) + value;
      break;
    // display: (flex|inline-flex|grid|inline-grid)
    case 6444:
      switch (charat(value, charat(value, 14) === 45 ? 18 : 11)) {
        // (inline-)?fle(x)
        case 120:
          return replace(value, /(.+:)([^;\s!]+)(;|(\s+)?!.+)?/, "$1" + WEBKIT + (charat(value, 14) === 45 ? "inline-" : "") + "box$3$1" + WEBKIT + "$2$3$1" + MS + "$2box$3") + value;
        // (inline-)?gri(d)
        case 100:
          return replace(value, ":", ":" + MS) + value;
      }
      break;
    // scroll-margin, scroll-margin-(top|right|bottom|left)
    case 5719:
    case 2647:
    case 2135:
    case 3927:
    case 2391:
      return replace(value, "scroll-", "scroll-snap-") + value;
  }
  return value;
}

// node_modules/stylis/src/Serializer.js
function serialize(children, callback) {
  var output = "";
  for (var i2 = 0; i2 < children.length; i2++)
    output += callback(children[i2], i2, children, callback) || "";
  return output;
}
function stringify(element, index2, children, callback) {
  switch (element.type) {
    case LAYER:
      if (element.children.length) break;
    case IMPORT:
    case DECLARATION:
      return element.return = element.return || element.value;
    case COMMENT:
      return "";
    case KEYFRAMES:
      return element.return = element.value + "{" + serialize(element.children, callback) + "}";
    case RULESET:
      if (!strlen(element.value = element.props.join(","))) return "";
  }
  return strlen(children = serialize(element.children, callback)) ? element.return = element.value + "{" + children + "}" : "";
}

// node_modules/stylis/src/Middleware.js
function middleware(collection) {
  var length2 = sizeof(collection);
  return function(element, index2, children, callback) {
    var output = "";
    for (var i2 = 0; i2 < length2; i2++)
      output += collection[i2](element, index2, children, callback) || "";
    return output;
  };
}
function rulesheet(callback) {
  return function(element) {
    if (!element.root) {
      if (element = element.return)
        callback(element);
    }
  };
}
function prefixer(element, index2, children, callback) {
  if (element.length > -1) {
    if (!element.return)
      switch (element.type) {
        case DECLARATION:
          element.return = prefix(element.value, element.length, children);
          return;
        case KEYFRAMES:
          return serialize([copy(element, { value: replace(element.value, "@", "@" + WEBKIT) })], callback);
        case RULESET:
          if (element.length)
            return combine(children = element.props, function(value) {
              switch (match(value, callback = /(::plac\w+|:read-\w+)/)) {
                // :read-(only|write)
                case ":read-only":
                case ":read-write":
                  lift(copy(element, { props: [replace(value, /:(read-\w+)/, ":" + MOZ + "$1")] }));
                  lift(copy(element, { props: [value] }));
                  assign(element, { props: filter(children, callback) });
                  break;
                // :placeholder
                case "::placeholder":
                  lift(copy(element, { props: [replace(value, /:(plac\w+)/, ":" + WEBKIT + "input-$1")] }));
                  lift(copy(element, { props: [replace(value, /:(plac\w+)/, ":" + MOZ + "$1")] }));
                  lift(copy(element, { props: [replace(value, /:(plac\w+)/, MS + "input-$1")] }));
                  lift(copy(element, { props: [value] }));
                  assign(element, { props: filter(children, callback) });
                  break;
              }
              return "";
            });
      }
  }
}

// node_modules/@emotion/unitless/dist/emotion-unitless.esm.js
var unitlessKeys = {
  animationIterationCount: 1,
  aspectRatio: 1,
  borderImageOutset: 1,
  borderImageSlice: 1,
  borderImageWidth: 1,
  boxFlex: 1,
  boxFlexGroup: 1,
  boxOrdinalGroup: 1,
  columnCount: 1,
  columns: 1,
  flex: 1,
  flexGrow: 1,
  flexPositive: 1,
  flexShrink: 1,
  flexNegative: 1,
  flexOrder: 1,
  gridRow: 1,
  gridRowEnd: 1,
  gridRowSpan: 1,
  gridRowStart: 1,
  gridColumn: 1,
  gridColumnEnd: 1,
  gridColumnSpan: 1,
  gridColumnStart: 1,
  msGridRow: 1,
  msGridRowSpan: 1,
  msGridColumn: 1,
  msGridColumnSpan: 1,
  fontWeight: 1,
  lineHeight: 1,
  opacity: 1,
  order: 1,
  orphans: 1,
  tabSize: 1,
  widows: 1,
  zIndex: 1,
  zoom: 1,
  WebkitLineClamp: 1,
  // SVG-related properties
  fillOpacity: 1,
  floodOpacity: 1,
  stopOpacity: 1,
  strokeDasharray: 1,
  strokeDashoffset: 1,
  strokeMiterlimit: 1,
  strokeOpacity: 1,
  strokeWidth: 1
};

// node_modules/styled-components/dist/styled-components.browser.esm.js
var f = "undefined" != typeof process && void 0 !== process.env && (process.env.REACT_APP_SC_ATTR || process.env.SC_ATTR) || "data-styled";
var m = "active";
var y = "data-styled-version";
var v = "6.1.19";
var g = "/*!sc*/\n";
var S = "undefined" != typeof window && "undefined" != typeof document;
var w = Boolean("boolean" == typeof SC_DISABLE_SPEEDY ? SC_DISABLE_SPEEDY : "undefined" != typeof process && void 0 !== process.env && void 0 !== process.env.REACT_APP_SC_DISABLE_SPEEDY && "" !== process.env.REACT_APP_SC_DISABLE_SPEEDY ? "false" !== process.env.REACT_APP_SC_DISABLE_SPEEDY && process.env.REACT_APP_SC_DISABLE_SPEEDY : "undefined" != typeof process && void 0 !== process.env && void 0 !== process.env.SC_DISABLE_SPEEDY && "" !== process.env.SC_DISABLE_SPEEDY ? "false" !== process.env.SC_DISABLE_SPEEDY && process.env.SC_DISABLE_SPEEDY : true);
var E = /invalid hook call/i;
var N = /* @__PURE__ */ new Set();
var P = function(t, n) {
  if (true) {
    var o2 = n ? ' with the id of "'.concat(n, '"') : "", s2 = "The component ".concat(t).concat(o2, " has been created dynamically.\n") + "You may see this warning because you've called styled inside another component.\nTo resolve this only create new StyledComponents outside of any render method and function component.\nSee https://styled-components.com/docs/basics#define-styled-components-outside-of-the-render-method for more info.\n", i2 = console.error;
    try {
      var a2 = true;
      console.error = function(t2) {
        for (var n2 = [], o3 = 1; o3 < arguments.length; o3++) n2[o3 - 1] = arguments[o3];
        E.test(t2) ? (a2 = false, N.delete(s2)) : i2.apply(void 0, __spreadArray([t2], n2, false));
      }, (0, import_react.useRef)(), a2 && !N.has(s2) && (console.warn(s2), N.add(s2));
    } catch (e) {
      E.test(e.message) && N.delete(s2);
    } finally {
      console.error = i2;
    }
  }
};
var _ = Object.freeze([]);
var C = Object.freeze({});
function I(e, t, n) {
  return void 0 === n && (n = C), e.theme !== n.theme && e.theme || t || n.theme;
}
var A = /* @__PURE__ */ new Set(["a", "abbr", "address", "area", "article", "aside", "audio", "b", "base", "bdi", "bdo", "big", "blockquote", "body", "br", "button", "canvas", "caption", "cite", "code", "col", "colgroup", "data", "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl", "dt", "em", "embed", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "html", "i", "iframe", "img", "input", "ins", "kbd", "keygen", "label", "legend", "li", "link", "main", "map", "mark", "menu", "menuitem", "meta", "meter", "nav", "noscript", "object", "ol", "optgroup", "option", "output", "p", "param", "picture", "pre", "progress", "q", "rp", "rt", "ruby", "s", "samp", "script", "section", "select", "small", "source", "span", "strong", "style", "sub", "summary", "sup", "table", "tbody", "td", "textarea", "tfoot", "th", "thead", "time", "tr", "track", "u", "ul", "use", "var", "video", "wbr", "circle", "clipPath", "defs", "ellipse", "foreignObject", "g", "image", "line", "linearGradient", "marker", "mask", "path", "pattern", "polygon", "polyline", "radialGradient", "rect", "stop", "svg", "text", "tspan"]);
var O = /[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~-]+/g;
var D = /(^-|-$)/g;
function R(e) {
  return e.replace(O, "-").replace(D, "");
}
var T = /(a)(d)/gi;
var k = 52;
var j = function(e) {
  return String.fromCharCode(e + (e > 25 ? 39 : 97));
};
function x(e) {
  var t, n = "";
  for (t = Math.abs(e); t > k; t = t / k | 0) n = j(t % k) + n;
  return (j(t % k) + n).replace(T, "$1-$2");
}
var V;
var F = 5381;
var M = function(e, t) {
  for (var n = t.length; n; ) e = 33 * e ^ t.charCodeAt(--n);
  return e;
};
var z = function(e) {
  return M(F, e);
};
function $(e) {
  return x(z(e) >>> 0);
}
function B(e) {
  return "string" == typeof e && e || e.displayName || e.name || "Component";
}
function L(e) {
  return "string" == typeof e && e.charAt(0) === e.charAt(0).toLowerCase();
}
var G = "function" == typeof Symbol && Symbol.for;
var Y = G ? /* @__PURE__ */ Symbol.for("react.memo") : 60115;
var W = G ? /* @__PURE__ */ Symbol.for("react.forward_ref") : 60112;
var q = { childContextTypes: true, contextType: true, contextTypes: true, defaultProps: true, displayName: true, getDefaultProps: true, getDerivedStateFromError: true, getDerivedStateFromProps: true, mixins: true, propTypes: true, type: true };
var H = { name: true, length: true, prototype: true, caller: true, callee: true, arguments: true, arity: true };
var U = { $$typeof: true, compare: true, defaultProps: true, displayName: true, propTypes: true, type: true };
var J = ((V = {})[W] = { $$typeof: true, render: true, defaultProps: true, displayName: true, propTypes: true }, V[Y] = U, V);
function X(e) {
  return ("type" in (t = e) && t.type.$$typeof) === Y ? U : "$$typeof" in e ? J[e.$$typeof] : q;
  var t;
}
var Z = Object.defineProperty;
var K = Object.getOwnPropertyNames;
var Q = Object.getOwnPropertySymbols;
var ee = Object.getOwnPropertyDescriptor;
var te = Object.getPrototypeOf;
var ne = Object.prototype;
function oe(e, t, n) {
  if ("string" != typeof t) {
    if (ne) {
      var o2 = te(t);
      o2 && o2 !== ne && oe(e, o2, n);
    }
    var r2 = K(t);
    Q && (r2 = r2.concat(Q(t)));
    for (var s2 = X(e), i2 = X(t), a2 = 0; a2 < r2.length; ++a2) {
      var c2 = r2[a2];
      if (!(c2 in H || n && n[c2] || i2 && c2 in i2 || s2 && c2 in s2)) {
        var l2 = ee(t, c2);
        try {
          Z(e, c2, l2);
        } catch (e2) {
        }
      }
    }
  }
  return e;
}
function re(e) {
  return "function" == typeof e;
}
function se(e) {
  return "object" == typeof e && "styledComponentId" in e;
}
function ie(e, t) {
  return e && t ? "".concat(e, " ").concat(t) : e || t || "";
}
function ae(e, t) {
  if (0 === e.length) return "";
  for (var n = e[0], o2 = 1; o2 < e.length; o2++) n += t ? t + e[o2] : e[o2];
  return n;
}
function ce(e) {
  return null !== e && "object" == typeof e && e.constructor.name === Object.name && !("props" in e && e.$$typeof);
}
function le(e, t, n) {
  if (void 0 === n && (n = false), !n && !ce(e) && !Array.isArray(e)) return t;
  if (Array.isArray(t)) for (var o2 = 0; o2 < t.length; o2++) e[o2] = le(e[o2], t[o2]);
  else if (ce(t)) for (var o2 in t) e[o2] = le(e[o2], t[o2]);
  return e;
}
function ue(e, t) {
  Object.defineProperty(e, "toString", { value: t });
}
var pe = true ? { 1: "Cannot create styled-component for component: %s.\n\n", 2: "Can't collect styles once you've consumed a `ServerStyleSheet`'s styles! `ServerStyleSheet` is a one off instance for each server-side render cycle.\n\n- Are you trying to reuse it across renders?\n- Are you accidentally calling collectStyles twice?\n\n", 3: "Streaming SSR is only supported in a Node.js environment; Please do not try to call this method in the browser.\n\n", 4: "The `StyleSheetManager` expects a valid target or sheet prop!\n\n- Does this error occur on the client and is your target falsy?\n- Does this error occur on the server and is the sheet falsy?\n\n", 5: "The clone method cannot be used on the client!\n\n- Are you running in a client-like environment on the server?\n- Are you trying to run SSR on the client?\n\n", 6: "Trying to insert a new style tag, but the given Node is unmounted!\n\n- Are you using a custom target that isn't mounted?\n- Does your document not have a valid head element?\n- Have you accidentally removed a style tag manually?\n\n", 7: 'ThemeProvider: Please return an object from your "theme" prop function, e.g.\n\n```js\ntheme={() => ({})}\n```\n\n', 8: 'ThemeProvider: Please make your "theme" prop an object.\n\n', 9: "Missing document `<head>`\n\n", 10: "Cannot find a StyleSheet instance. Usually this happens if there are multiple copies of styled-components loaded at once. Check out this issue for how to troubleshoot and fix the common cases where this situation can happen: https://github.com/styled-components/styled-components/issues/1941#issuecomment-417862021\n\n", 11: "_This error was replaced with a dev-time warning, it will be deleted for v4 final._ [createGlobalStyle] received children which will not be rendered. Please use the component without passing children elements.\n\n", 12: "It seems you are interpolating a keyframe declaration (%s) into an untagged string. This was supported in styled-components v3, but is not longer supported in v4 as keyframes are now injected on-demand. Please wrap your string in the css\\`\\` helper which ensures the styles are injected correctly. See https://www.styled-components.com/docs/api#css\n\n", 13: "%s is not a styled component and cannot be referred to via component selector. See https://www.styled-components.com/docs/advanced#referring-to-other-components for more details.\n\n", 14: 'ThemeProvider: "theme" prop is required.\n\n', 15: "A stylis plugin has been supplied that is not named. We need a name for each plugin to be able to prevent styling collisions between different stylis configurations within the same app. Before you pass your plugin to `<StyleSheetManager stylisPlugins={[]}>`, please make sure each plugin is uniquely-named, e.g.\n\n```js\nObject.defineProperty(importedPlugin, 'name', { value: 'some-unique-name' });\n```\n\n", 16: "Reached the limit of how many styled components may be created at group %s.\nYou may only create up to 1,073,741,824 components. If you're creating components dynamically,\nas for instance in your render method then you may be running into this limitation.\n\n", 17: "CSSStyleSheet could not be found on HTMLStyleElement.\nHas styled-components' style tag been unmounted or altered by another script?\n", 18: "ThemeProvider: Please make sure your useTheme hook is within a `<ThemeProvider>`" } : {};
function de() {
  for (var e = [], t = 0; t < arguments.length; t++) e[t] = arguments[t];
  for (var n = e[0], o2 = [], r2 = 1, s2 = e.length; r2 < s2; r2 += 1) o2.push(e[r2]);
  return o2.forEach(function(e2) {
    n = n.replace(/%[a-z]/, e2);
  }), n;
}
function he(t) {
  for (var n = [], o2 = 1; o2 < arguments.length; o2++) n[o2 - 1] = arguments[o2];
  return false ? new Error("An error occurred. See https://github.com/styled-components/styled-components/blob/main/packages/styled-components/src/utils/errors.md#".concat(t, " for more information.").concat(n.length > 0 ? " Args: ".concat(n.join(", ")) : "")) : new Error(de.apply(void 0, __spreadArray([pe[t]], n, false)).trim());
}
var fe = (function() {
  function e(e2) {
    this.groupSizes = new Uint32Array(512), this.length = 512, this.tag = e2;
  }
  return e.prototype.indexOfGroup = function(e2) {
    for (var t = 0, n = 0; n < e2; n++) t += this.groupSizes[n];
    return t;
  }, e.prototype.insertRules = function(e2, t) {
    if (e2 >= this.groupSizes.length) {
      for (var n = this.groupSizes, o2 = n.length, r2 = o2; e2 >= r2; ) if ((r2 <<= 1) < 0) throw he(16, "".concat(e2));
      this.groupSizes = new Uint32Array(r2), this.groupSizes.set(n), this.length = r2;
      for (var s2 = o2; s2 < r2; s2++) this.groupSizes[s2] = 0;
    }
    for (var i2 = this.indexOfGroup(e2 + 1), a2 = (s2 = 0, t.length); s2 < a2; s2++) this.tag.insertRule(i2, t[s2]) && (this.groupSizes[e2]++, i2++);
  }, e.prototype.clearGroup = function(e2) {
    if (e2 < this.length) {
      var t = this.groupSizes[e2], n = this.indexOfGroup(e2), o2 = n + t;
      this.groupSizes[e2] = 0;
      for (var r2 = n; r2 < o2; r2++) this.tag.deleteRule(n);
    }
  }, e.prototype.getGroup = function(e2) {
    var t = "";
    if (e2 >= this.length || 0 === this.groupSizes[e2]) return t;
    for (var n = this.groupSizes[e2], o2 = this.indexOfGroup(e2), r2 = o2 + n, s2 = o2; s2 < r2; s2++) t += "".concat(this.tag.getRule(s2)).concat(g);
    return t;
  }, e;
})();
var me = 1 << 30;
var ye = /* @__PURE__ */ new Map();
var ve = /* @__PURE__ */ new Map();
var ge = 1;
var Se = function(e) {
  if (ye.has(e)) return ye.get(e);
  for (; ve.has(ge); ) ge++;
  var t = ge++;
  if ((0 | t) < 0 || t > me) throw he(16, "".concat(t));
  return ye.set(e, t), ve.set(t, e), t;
};
var we = function(e, t) {
  ge = t + 1, ye.set(e, t), ve.set(t, e);
};
var be = "style[".concat(f, "][").concat(y, '="').concat(v, '"]');
var Ee = new RegExp("^".concat(f, '\\.g(\\d+)\\[id="([\\w\\d-]+)"\\].*?"([^"]*)'));
var Ne = function(e, t, n) {
  for (var o2, r2 = n.split(","), s2 = 0, i2 = r2.length; s2 < i2; s2++) (o2 = r2[s2]) && e.registerName(t, o2);
};
var Pe = function(e, t) {
  for (var n, o2 = (null !== (n = t.textContent) && void 0 !== n ? n : "").split(g), r2 = [], s2 = 0, i2 = o2.length; s2 < i2; s2++) {
    var a2 = o2[s2].trim();
    if (a2) {
      var c2 = a2.match(Ee);
      if (c2) {
        var l2 = 0 | parseInt(c2[1], 10), u2 = c2[2];
        0 !== l2 && (we(u2, l2), Ne(e, u2, c2[3]), e.getTag().insertRules(l2, r2)), r2.length = 0;
      } else r2.push(a2);
    }
  }
};
var _e = function(e) {
  for (var t = document.querySelectorAll(be), n = 0, o2 = t.length; n < o2; n++) {
    var r2 = t[n];
    r2 && r2.getAttribute(f) !== m && (Pe(e, r2), r2.parentNode && r2.parentNode.removeChild(r2));
  }
};
function Ce() {
  return "undefined" != typeof __webpack_nonce__ ? __webpack_nonce__ : null;
}
var Ie = function(e) {
  var t = document.head, n = e || t, o2 = document.createElement("style"), r2 = (function(e2) {
    var t2 = Array.from(e2.querySelectorAll("style[".concat(f, "]")));
    return t2[t2.length - 1];
  })(n), s2 = void 0 !== r2 ? r2.nextSibling : null;
  o2.setAttribute(f, m), o2.setAttribute(y, v);
  var i2 = Ce();
  return i2 && o2.setAttribute("nonce", i2), n.insertBefore(o2, s2), o2;
};
var Ae = (function() {
  function e(e2) {
    this.element = Ie(e2), this.element.appendChild(document.createTextNode("")), this.sheet = (function(e3) {
      if (e3.sheet) return e3.sheet;
      for (var t = document.styleSheets, n = 0, o2 = t.length; n < o2; n++) {
        var r2 = t[n];
        if (r2.ownerNode === e3) return r2;
      }
      throw he(17);
    })(this.element), this.length = 0;
  }
  return e.prototype.insertRule = function(e2, t) {
    try {
      return this.sheet.insertRule(t, e2), this.length++, true;
    } catch (e3) {
      return false;
    }
  }, e.prototype.deleteRule = function(e2) {
    this.sheet.deleteRule(e2), this.length--;
  }, e.prototype.getRule = function(e2) {
    var t = this.sheet.cssRules[e2];
    return t && t.cssText ? t.cssText : "";
  }, e;
})();
var Oe = (function() {
  function e(e2) {
    this.element = Ie(e2), this.nodes = this.element.childNodes, this.length = 0;
  }
  return e.prototype.insertRule = function(e2, t) {
    if (e2 <= this.length && e2 >= 0) {
      var n = document.createTextNode(t);
      return this.element.insertBefore(n, this.nodes[e2] || null), this.length++, true;
    }
    return false;
  }, e.prototype.deleteRule = function(e2) {
    this.element.removeChild(this.nodes[e2]), this.length--;
  }, e.prototype.getRule = function(e2) {
    return e2 < this.length ? this.nodes[e2].textContent : "";
  }, e;
})();
var De = (function() {
  function e(e2) {
    this.rules = [], this.length = 0;
  }
  return e.prototype.insertRule = function(e2, t) {
    return e2 <= this.length && (this.rules.splice(e2, 0, t), this.length++, true);
  }, e.prototype.deleteRule = function(e2) {
    this.rules.splice(e2, 1), this.length--;
  }, e.prototype.getRule = function(e2) {
    return e2 < this.length ? this.rules[e2] : "";
  }, e;
})();
var Re = S;
var Te = { isServer: !S, useCSSOMInjection: !w };
var ke = (function() {
  function e(e2, n, o2) {
    void 0 === e2 && (e2 = C), void 0 === n && (n = {});
    var r2 = this;
    this.options = __assign(__assign({}, Te), e2), this.gs = n, this.names = new Map(o2), this.server = !!e2.isServer, !this.server && S && Re && (Re = false, _e(this)), ue(this, function() {
      return (function(e3) {
        for (var t = e3.getTag(), n2 = t.length, o3 = "", r3 = function(n3) {
          var r4 = (function(e4) {
            return ve.get(e4);
          })(n3);
          if (void 0 === r4) return "continue";
          var s3 = e3.names.get(r4), i2 = t.getGroup(n3);
          if (void 0 === s3 || !s3.size || 0 === i2.length) return "continue";
          var a2 = "".concat(f, ".g").concat(n3, '[id="').concat(r4, '"]'), c2 = "";
          void 0 !== s3 && s3.forEach(function(e4) {
            e4.length > 0 && (c2 += "".concat(e4, ","));
          }), o3 += "".concat(i2).concat(a2, '{content:"').concat(c2, '"}').concat(g);
        }, s2 = 0; s2 < n2; s2++) r3(s2);
        return o3;
      })(r2);
    });
  }
  return e.registerId = function(e2) {
    return Se(e2);
  }, e.prototype.rehydrate = function() {
    !this.server && S && _e(this);
  }, e.prototype.reconstructWithOptions = function(n, o2) {
    return void 0 === o2 && (o2 = true), new e(__assign(__assign({}, this.options), n), this.gs, o2 && this.names || void 0);
  }, e.prototype.allocateGSInstance = function(e2) {
    return this.gs[e2] = (this.gs[e2] || 0) + 1;
  }, e.prototype.getTag = function() {
    return this.tag || (this.tag = (e2 = (function(e3) {
      var t = e3.useCSSOMInjection, n = e3.target;
      return e3.isServer ? new De(n) : t ? new Ae(n) : new Oe(n);
    })(this.options), new fe(e2)));
    var e2;
  }, e.prototype.hasNameForId = function(e2, t) {
    return this.names.has(e2) && this.names.get(e2).has(t);
  }, e.prototype.registerName = function(e2, t) {
    if (Se(e2), this.names.has(e2)) this.names.get(e2).add(t);
    else {
      var n = /* @__PURE__ */ new Set();
      n.add(t), this.names.set(e2, n);
    }
  }, e.prototype.insertRules = function(e2, t, n) {
    this.registerName(e2, t), this.getTag().insertRules(Se(e2), n);
  }, e.prototype.clearNames = function(e2) {
    this.names.has(e2) && this.names.get(e2).clear();
  }, e.prototype.clearRules = function(e2) {
    this.getTag().clearGroup(Se(e2)), this.clearNames(e2);
  }, e.prototype.clearTag = function() {
    this.tag = void 0;
  }, e;
})();
var je = /&/g;
var xe = /^\s*\/\/.*$/gm;
function Ve(e, t) {
  return e.map(function(e2) {
    return "rule" === e2.type && (e2.value = "".concat(t, " ").concat(e2.value), e2.value = e2.value.replaceAll(",", ",".concat(t, " ")), e2.props = e2.props.map(function(e3) {
      return "".concat(t, " ").concat(e3);
    })), Array.isArray(e2.children) && "@keyframes" !== e2.type && (e2.children = Ve(e2.children, t)), e2;
  });
}
function Fe(e) {
  var t, n, o2, r2 = void 0 === e ? C : e, s2 = r2.options, i2 = void 0 === s2 ? C : s2, a2 = r2.plugins, c2 = void 0 === a2 ? _ : a2, l2 = function(e2, o3, r3) {
    return r3.startsWith(n) && r3.endsWith(n) && r3.replaceAll(n, "").length > 0 ? ".".concat(t) : e2;
  }, u2 = c2.slice();
  u2.push(function(e2) {
    e2.type === RULESET && e2.value.includes("&") && (e2.props[0] = e2.props[0].replace(je, n).replace(o2, l2));
  }), i2.prefix && u2.push(prefixer), u2.push(stringify);
  var p2 = function(e2, r3, s3, a3) {
    void 0 === r3 && (r3 = ""), void 0 === s3 && (s3 = ""), void 0 === a3 && (a3 = "&"), t = a3, n = r3, o2 = new RegExp("\\".concat(n, "\\b"), "g");
    var c3 = e2.replace(xe, ""), l3 = compile(s3 || r3 ? "".concat(s3, " ").concat(r3, " { ").concat(c3, " }") : c3);
    i2.namespace && (l3 = Ve(l3, i2.namespace));
    var p3 = [];
    return serialize(l3, middleware(u2.concat(rulesheet(function(e3) {
      return p3.push(e3);
    })))), p3;
  };
  return p2.hash = c2.length ? c2.reduce(function(e2, t2) {
    return t2.name || he(15), M(e2, t2.name);
  }, F).toString() : "", p2;
}
var Me = new ke();
var ze = Fe();
var $e = import_react.default.createContext({ shouldForwardProp: void 0, styleSheet: Me, stylis: ze });
var Be = $e.Consumer;
var Le = import_react.default.createContext(void 0);
function Ge() {
  return (0, import_react.useContext)($e);
}
function Ye(e) {
  var t = (0, import_react.useState)(e.stylisPlugins), n = t[0], r2 = t[1], c2 = Ge().styleSheet, l2 = (0, import_react.useMemo)(function() {
    var t2 = c2;
    return e.sheet ? t2 = e.sheet : e.target && (t2 = t2.reconstructWithOptions({ target: e.target }, false)), e.disableCSSOMInjection && (t2 = t2.reconstructWithOptions({ useCSSOMInjection: false })), t2;
  }, [e.disableCSSOMInjection, e.sheet, e.target, c2]), u2 = (0, import_react.useMemo)(function() {
    return Fe({ options: { namespace: e.namespace, prefix: e.enableVendorPrefixes }, plugins: n });
  }, [e.enableVendorPrefixes, e.namespace, n]);
  (0, import_react.useEffect)(function() {
    (0, import_shallowequal.default)(n, e.stylisPlugins) || r2(e.stylisPlugins);
  }, [e.stylisPlugins]);
  var d = (0, import_react.useMemo)(function() {
    return { shouldForwardProp: e.shouldForwardProp, styleSheet: l2, stylis: u2 };
  }, [e.shouldForwardProp, l2, u2]);
  return import_react.default.createElement($e.Provider, { value: d }, import_react.default.createElement(Le.Provider, { value: u2 }, e.children));
}
var We = (function() {
  function e(e2, t) {
    var n = this;
    this.inject = function(e3, t2) {
      void 0 === t2 && (t2 = ze);
      var o2 = n.name + t2.hash;
      e3.hasNameForId(n.id, o2) || e3.insertRules(n.id, o2, t2(n.rules, o2, "@keyframes"));
    }, this.name = e2, this.id = "sc-keyframes-".concat(e2), this.rules = t, ue(this, function() {
      throw he(12, String(n.name));
    });
  }
  return e.prototype.getName = function(e2) {
    return void 0 === e2 && (e2 = ze), this.name + e2.hash;
  }, e;
})();
var qe = function(e) {
  return e >= "A" && e <= "Z";
};
function He(e) {
  for (var t = "", n = 0; n < e.length; n++) {
    var o2 = e[n];
    if (1 === n && "-" === o2 && "-" === e[0]) return e;
    qe(o2) ? t += "-" + o2.toLowerCase() : t += o2;
  }
  return t.startsWith("ms-") ? "-" + t : t;
}
var Ue = function(e) {
  return null == e || false === e || "" === e;
};
var Je = function(t) {
  var n, o2, r2 = [];
  for (var s2 in t) {
    var i2 = t[s2];
    t.hasOwnProperty(s2) && !Ue(i2) && (Array.isArray(i2) && i2.isCss || re(i2) ? r2.push("".concat(He(s2), ":"), i2, ";") : ce(i2) ? r2.push.apply(r2, __spreadArray(__spreadArray(["".concat(s2, " {")], Je(i2), false), ["}"], false)) : r2.push("".concat(He(s2), ": ").concat((n = s2, null == (o2 = i2) || "boolean" == typeof o2 || "" === o2 ? "" : "number" != typeof o2 || 0 === o2 || n in unitlessKeys || n.startsWith("--") ? String(o2).trim() : "".concat(o2, "px")), ";")));
  }
  return r2;
};
function Xe(e, t, n, o2) {
  if (Ue(e)) return [];
  if (se(e)) return [".".concat(e.styledComponentId)];
  if (re(e)) {
    if (!re(s2 = e) || s2.prototype && s2.prototype.isReactComponent || !t) return [e];
    var r2 = e(t);
    return "object" != typeof r2 || Array.isArray(r2) || r2 instanceof We || ce(r2) || null === r2 || console.error("".concat(B(e), " is not a styled component and cannot be referred to via component selector. See https://www.styled-components.com/docs/advanced#referring-to-other-components for more details.")), Xe(r2, t, n, o2);
  }
  var s2;
  return e instanceof We ? n ? (e.inject(n, o2), [e.getName(o2)]) : [e] : ce(e) ? Je(e) : Array.isArray(e) ? Array.prototype.concat.apply(_, e.map(function(e2) {
    return Xe(e2, t, n, o2);
  })) : [e.toString()];
}
function Ze(e) {
  for (var t = 0; t < e.length; t += 1) {
    var n = e[t];
    if (re(n) && !se(n)) return false;
  }
  return true;
}
var Ke = z(v);
var Qe = (function() {
  function e(e2, t, n) {
    this.rules = e2, this.staticRulesId = "", this.isStatic = false, this.componentId = t, this.baseHash = M(Ke, t), this.baseStyle = n, ke.registerId(t);
  }
  return e.prototype.generateAndInjectStyles = function(e2, t, n) {
    var o2 = this.baseStyle ? this.baseStyle.generateAndInjectStyles(e2, t, n) : "";
    if (this.isStatic && !n.hash) if (this.staticRulesId && t.hasNameForId(this.componentId, this.staticRulesId)) o2 = ie(o2, this.staticRulesId);
    else {
      var r2 = ae(Xe(this.rules, e2, t, n)), s2 = x(M(this.baseHash, r2) >>> 0);
      if (!t.hasNameForId(this.componentId, s2)) {
        var i2 = n(r2, ".".concat(s2), void 0, this.componentId);
        t.insertRules(this.componentId, s2, i2);
      }
      o2 = ie(o2, s2), this.staticRulesId = s2;
    }
    else {
      for (var a2 = M(this.baseHash, n.hash), c2 = "", l2 = 0; l2 < this.rules.length; l2++) {
        var u2 = this.rules[l2];
        if ("string" == typeof u2) c2 += u2, a2 = M(a2, u2);
        else if (u2) {
          var p2 = ae(Xe(u2, e2, t, n));
          a2 = M(a2, p2 + l2), c2 += p2;
        }
      }
      if (c2) {
        var d = x(a2 >>> 0);
        t.hasNameForId(this.componentId, d) || t.insertRules(this.componentId, d, n(c2, ".".concat(d), void 0, this.componentId)), o2 = ie(o2, d);
      }
    }
    return o2;
  }, e;
})();
var et = import_react.default.createContext(void 0);
var tt = et.Consumer;
var rt = {};
function it(e, r2, s2) {
  var i2 = se(e), a2 = e, c2 = !L(e), p2 = r2.attrs, d = void 0 === p2 ? _ : p2, h = r2.componentId, f2 = void 0 === h ? (function(e2, t) {
    var n = "string" != typeof e2 ? "sc" : R(e2);
    rt[n] = (rt[n] || 0) + 1;
    var o2 = "".concat(n, "-").concat($(v + n + rt[n]));
    return t ? "".concat(t, "-").concat(o2) : o2;
  })(r2.displayName, r2.parentComponentId) : h, m2 = r2.displayName, y2 = void 0 === m2 ? (function(e2) {
    return L(e2) ? "styled.".concat(e2) : "Styled(".concat(B(e2), ")");
  })(e) : m2, g2 = r2.displayName && r2.componentId ? "".concat(R(r2.displayName), "-").concat(r2.componentId) : r2.componentId || f2, S2 = i2 && a2.attrs ? a2.attrs.concat(d).filter(Boolean) : d, w2 = r2.shouldForwardProp;
  if (i2 && a2.shouldForwardProp) {
    var b = a2.shouldForwardProp;
    if (r2.shouldForwardProp) {
      var E2 = r2.shouldForwardProp;
      w2 = function(e2, t) {
        return b(e2, t) && E2(e2, t);
      };
    } else w2 = b;
  }
  var N2 = new Qe(s2, g2, i2 ? a2.componentStyle : void 0);
  function O2(e2, r3) {
    return (function(e3, r4, s3) {
      var i3 = e3.attrs, a3 = e3.componentStyle, c3 = e3.defaultProps, p3 = e3.foldedComponentIds, d2 = e3.styledComponentId, h2 = e3.target, f3 = import_react.default.useContext(et), m3 = Ge(), y3 = e3.shouldForwardProp || m3.shouldForwardProp;
      (0, import_react.useDebugValue)(d2);
      var v2 = I(r4, f3, c3) || C, g3 = (function(e4, n, o2) {
        for (var r5, s4 = __assign(__assign({}, n), { className: void 0, theme: o2 }), i4 = 0; i4 < e4.length; i4 += 1) {
          var a4 = re(r5 = e4[i4]) ? r5(s4) : r5;
          for (var c4 in a4) s4[c4] = "className" === c4 ? ie(s4[c4], a4[c4]) : "style" === c4 ? __assign(__assign({}, s4[c4]), a4[c4]) : a4[c4];
        }
        return n.className && (s4.className = ie(s4.className, n.className)), s4;
      })(i3, r4, v2), S3 = g3.as || h2, w3 = {};
      for (var b2 in g3) void 0 === g3[b2] || "$" === b2[0] || "as" === b2 || "theme" === b2 && g3.theme === v2 || ("forwardedAs" === b2 ? w3.as = g3.forwardedAs : y3 && !y3(b2, S3) || (w3[b2] = g3[b2], y3 || true));
      var E3 = (function(e4, t) {
        var n = Ge(), o2 = e4.generateAndInjectStyles(t, n.styleSheet, n.stylis);
        return (0, import_react.useDebugValue)(o2), o2;
      })(a3, g3);
      e3.warnTooManyClasses && e3.warnTooManyClasses(E3);
      var N3 = ie(p3, d2);
      return E3 && (N3 += " " + E3), g3.className && (N3 += " " + g3.className), w3[L(S3) && !A.has(S3) ? "class" : "className"] = N3, s3 && (w3.ref = s3), (0, import_react.createElement)(S3, w3);
    })(D2, e2, r3);
  }
  O2.displayName = y2;
  var D2 = import_react.default.forwardRef(O2);
  return D2.attrs = S2, D2.componentStyle = N2, D2.displayName = y2, D2.shouldForwardProp = w2, D2.foldedComponentIds = i2 ? ie(a2.foldedComponentIds, a2.styledComponentId) : "", D2.styledComponentId = g2, D2.target = i2 ? a2.target : e, Object.defineProperty(D2, "defaultProps", { get: function() {
    return this._foldedDefaultProps;
  }, set: function(e2) {
    this._foldedDefaultProps = i2 ? (function(e3) {
      for (var t = [], n = 1; n < arguments.length; n++) t[n - 1] = arguments[n];
      for (var o2 = 0, r3 = t; o2 < r3.length; o2++) le(e3, r3[o2], true);
      return e3;
    })({}, a2.defaultProps, e2) : e2;
  } }), P(y2, g2), D2.warnTooManyClasses = /* @__PURE__ */ (function(e2, t) {
    var n = {}, o2 = false;
    return function(r3) {
      if (!o2 && (n[r3] = true, Object.keys(n).length >= 200)) {
        var s3 = t ? ' with the id of "'.concat(t, '"') : "";
        console.warn("Over ".concat(200, " classes were generated for component ").concat(e2).concat(s3, ".\n") + "Consider using the attrs method, together with a style object for frequently changed styles.\nExample:\n  const Component = styled.div.attrs(props => ({\n    style: {\n      background: props.background,\n    },\n  }))`width: 100%;`\n\n  <Component />"), o2 = true, n = {};
      }
    };
  })(y2, g2), ue(D2, function() {
    return ".".concat(D2.styledComponentId);
  }), c2 && oe(D2, e, { attrs: true, componentStyle: true, displayName: true, foldedComponentIds: true, shouldForwardProp: true, styledComponentId: true, target: true }), D2;
}
function at(e, t) {
  for (var n = [e[0]], o2 = 0, r2 = t.length; o2 < r2; o2 += 1) n.push(t[o2], e[o2 + 1]);
  return n;
}
var ct = function(e) {
  return Object.assign(e, { isCss: true });
};
function lt(t) {
  for (var n = [], o2 = 1; o2 < arguments.length; o2++) n[o2 - 1] = arguments[o2];
  if (re(t) || ce(t)) return ct(Xe(at(_, __spreadArray([t], n, true))));
  var r2 = t;
  return 0 === n.length && 1 === r2.length && "string" == typeof r2[0] ? Xe(r2) : ct(Xe(at(r2, n)));
}
function ut(n, o2, r2) {
  if (void 0 === r2 && (r2 = C), !o2) throw he(1, o2);
  var s2 = function(t) {
    for (var s3 = [], i2 = 1; i2 < arguments.length; i2++) s3[i2 - 1] = arguments[i2];
    return n(o2, r2, lt.apply(void 0, __spreadArray([t], s3, false)));
  };
  return s2.attrs = function(e) {
    return ut(n, o2, __assign(__assign({}, r2), { attrs: Array.prototype.concat(r2.attrs, e).filter(Boolean) }));
  }, s2.withConfig = function(e) {
    return ut(n, o2, __assign(__assign({}, r2), e));
  }, s2;
}
var pt = function(e) {
  return ut(it, e);
};
var dt = pt;
A.forEach(function(e) {
  dt[e] = pt(e);
});
var ht = (function() {
  function e(e2, t) {
    this.rules = e2, this.componentId = t, this.isStatic = Ze(e2), ke.registerId(this.componentId + 1);
  }
  return e.prototype.createStyles = function(e2, t, n, o2) {
    var r2 = o2(ae(Xe(this.rules, t, n, o2)), ""), s2 = this.componentId + e2;
    n.insertRules(s2, s2, r2);
  }, e.prototype.removeStyles = function(e2, t) {
    t.clearRules(this.componentId + e2);
  }, e.prototype.renderStyles = function(e2, t, n, o2) {
    e2 > 2 && ke.registerId(this.componentId + e2), this.removeStyles(e2, n), this.createStyles(e2, t, n, o2);
  }, e;
})();
var vt = (function() {
  function e() {
    var e2 = this;
    this._emitSheetCSS = function() {
      var t = e2.instance.toString();
      if (!t) return "";
      var n = Ce(), o2 = ae([n && 'nonce="'.concat(n, '"'), "".concat(f, '="true"'), "".concat(y, '="').concat(v, '"')].filter(Boolean), " ");
      return "<style ".concat(o2, ">").concat(t, "</style>");
    }, this.getStyleTags = function() {
      if (e2.sealed) throw he(2);
      return e2._emitSheetCSS();
    }, this.getStyleElement = function() {
      var n;
      if (e2.sealed) throw he(2);
      var r2 = e2.instance.toString();
      if (!r2) return [];
      var s2 = ((n = {})[f] = "", n[y] = v, n.dangerouslySetInnerHTML = { __html: r2 }, n), i2 = Ce();
      return i2 && (s2.nonce = i2), [import_react.default.createElement("style", __assign({}, s2, { key: "sc-0-0" }))];
    }, this.seal = function() {
      e2.sealed = true;
    }, this.instance = new ke({ isServer: true }), this.sealed = false;
  }
  return e.prototype.collectStyles = function(e2) {
    if (this.sealed) throw he(2);
    return import_react.default.createElement(Ye, { sheet: this.instance }, e2);
  }, e.prototype.interleaveWithNodeStream = function(e2) {
    throw he(3);
  }, e;
})();
"undefined" != typeof navigator && "ReactNative" === navigator.product && console.warn("It looks like you've imported 'styled-components' on React Native.\nPerhaps you're looking to import 'styled-components/native'?\nRead more about this at https://www.styled-components.com/docs/basics#react-native");
var St = "__sc-".concat(f, "__");

// node_modules/@babel/runtime/helpers/esm/extends.js
function _extends() {
  return _extends = Object.assign ? Object.assign.bind() : function(n) {
    for (var e = 1; e < arguments.length; e++) {
      var t = arguments[e];
      for (var r2 in t) ({}).hasOwnProperty.call(t, r2) && (n[r2] = t[r2]);
    }
    return n;
  }, _extends.apply(null, arguments);
}

// node_modules/@babel/runtime/helpers/esm/objectWithoutPropertiesLoose.js
function _objectWithoutPropertiesLoose(r2, e) {
  if (null == r2) return {};
  var t = {};
  for (var n in r2) if ({}.hasOwnProperty.call(r2, n)) {
    if (-1 !== e.indexOf(n)) continue;
    t[n] = r2[n];
  }
  return t;
}

// node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js
function _objectWithoutProperties(e, t) {
  if (null == e) return {};
  var o2, r2, i2 = _objectWithoutPropertiesLoose(e, t);
  if (Object.getOwnPropertySymbols) {
    var n = Object.getOwnPropertySymbols(e);
    for (r2 = 0; r2 < n.length; r2++) o2 = n[r2], -1 === t.indexOf(o2) && {}.propertyIsEnumerable.call(e, o2) && (i2[o2] = e[o2]);
  }
  return i2;
}

// node_modules/rete-react-plugin/rete-react-plugin.esm.js
function getRenderer(props) {
  var createRoot = props === null || props === void 0 ? void 0 : props.createRoot;
  var wrappers = /* @__PURE__ */ new WeakMap();
  function getWrapper(container) {
    var wrapper = wrappers.get(container);
    if (wrapper) return wrapper;
    var span = document.createElement("span");
    container.appendChild(span);
    wrappers.set(container, span);
    return span;
  }
  function removeWrapper(container) {
    var wrapper = wrappers.get(container);
    if (wrapper) {
      wrapper.remove();
      wrappers["delete"](container);
    }
  }
  if (createRoot) {
    var roots = /* @__PURE__ */ new WeakMap();
    return {
      mount: function mount(element, container) {
        var _wrapper$firstElement;
        var wrapper = getWrapper(container);
        var root = roots.get(wrapper);
        if (!root) {
          root = createRoot(wrapper);
          roots.set(wrapper, root);
        }
        root.render(element);
        return (_wrapper$firstElement = wrapper.firstElementChild) !== null && _wrapper$firstElement !== void 0 ? _wrapper$firstElement : wrapper;
      },
      unmount: function unmount(container) {
        var wrapper = getWrapper(container);
        var root = roots.get(wrapper);
        if (root) {
          root.unmount();
          roots["delete"](wrapper);
        }
        removeWrapper(container);
      }
    };
  }
  return {
    mount: function mount(element, container) {
      var wrapper = getWrapper(container);
      if ("render" in ReactDOM && typeof ReactDOM.render === "function") {
        var result = ReactDOM.render(element, wrapper);
        return result || wrapper;
      }
      throw new Error("ReactDOM.render is not available");
    },
    unmount: function unmount(container) {
      var wrapper = getWrapper(container);
      if ("unmountComponentAtNode" in ReactDOM && typeof ReactDOM.unmountComponentAtNode === "function") {
        ReactDOM.unmountComponentAtNode(wrapper);
      } else {
        throw new Error("ReactDOM.unmountComponentAtNode is not available");
      }
      removeWrapper(container);
    }
  };
}
function Root(_ref) {
  var children = _ref.children, rendered = _ref.rendered;
  (0, import_react2.useEffect)(function() {
    rendered();
  });
  return children;
}
function syncFlush() {
  var ready = (0, import_react2.useRef)(false);
  (0, import_react2.useEffect)(function() {
    ready.current = true;
  }, []);
  return {
    apply: function apply(f2) {
      if (ready.current) {
        queueMicrotask(function() {
          (0, import_react_dom.flushSync)(f2);
        });
      } else {
        f2();
      }
    }
  };
}
function useRete(create) {
  var _useState = (0, import_react2.useState)(null), _useState2 = _slicedToArray(_useState, 2), container = _useState2[0], setContainer = _useState2[1];
  var editorRef = (0, import_react2.useRef)(void 0);
  var _useState3 = (0, import_react2.useState)(null), _useState4 = _slicedToArray(_useState3, 2), editor = _useState4[0], setEditor = _useState4[1];
  var ref = (0, import_react2.useRef)(null);
  (0, import_react2.useEffect)(function() {
    if (container) {
      if (editorRef.current) {
        editorRef.current.destroy();
        container.innerHTML = "";
      }
      void create(container).then(function(value) {
        editorRef.current = value;
        setEditor(value);
      });
    }
  }, [container, create]);
  (0, import_react2.useEffect)(function() {
    return function() {
      if (editorRef.current) {
        editorRef.current.destroy();
      }
    };
  }, []);
  (0, import_react2.useEffect)(function() {
    if (ref.current) {
      setContainer(ref.current);
    }
  }, [ref.current]);
  return [ref, editor];
}
var ConnectionContext = (0, import_react2.createContext)({
  start: null,
  end: null,
  path: null
});
function ConnectionWrapper(props) {
  var children = props.children;
  var _useState = (0, import_react2.useState)(null), _useState2 = _slicedToArray(_useState, 2), computedStart = _useState2[0], setStart = _useState2[1];
  var _useState3 = (0, import_react2.useState)(null), _useState4 = _slicedToArray(_useState3, 2), computedEnd = _useState4[0], setEnd = _useState4[1];
  var _useState5 = (0, import_react2.useState)(null), _useState6 = _slicedToArray(_useState5, 2), path = _useState6[0], setPath = _useState6[1];
  var start = "x" in props.start ? props.start : computedStart;
  var end = "x" in props.end ? props.end : computedEnd;
  var flush = syncFlush();
  (0, import_react2.useEffect)(function() {
    var unwatch1 = typeof props.start === "function" && props.start(function(s2) {
      flush.apply(function() {
        setStart(s2);
      });
    });
    var unwatch2 = typeof props.end === "function" && props.end(function(s2) {
      flush.apply(function() {
        setEnd(s2);
      });
    });
    return function() {
      if (unwatch1) unwatch1();
      if (unwatch2) unwatch2();
    };
  }, []);
  (0, import_react2.useEffect)(function() {
    if (start && end) void props.path(start, end).then(function(p2) {
      flush.apply(function() {
        setPath(p2);
      });
    });
  }, [start, end]);
  return React.createElement(ConnectionContext.Provider, {
    value: {
      start,
      end,
      path
    }
  }, children);
}
function useConnection() {
  return (0, import_react2.useContext)(ConnectionContext);
}
var _templateObject$b;
var _templateObject2$3;
var Svg = dt.svg(_templateObject$b || (_templateObject$b = _taggedTemplateLiteral(["\n    overflow: visible !important;\n    position: absolute;\n    pointer-events: none;\n    width: 9999px;\n    height: 9999px;\n"])));
var Path = dt.path(_templateObject2$3 || (_templateObject2$3 = _taggedTemplateLiteral(["\n    fill: none;\n    stroke-width: 5px;\n    stroke: steelblue;\n    pointer-events: auto;\n    ", "\n"])), function(props) {
  var _props$styles;
  return (_props$styles = props.styles) === null || _props$styles === void 0 ? void 0 : _props$styles.call(props, props);
});
function Connection(props) {
  var _useConnection = useConnection(), path = _useConnection.path;
  if (!path) return null;
  return React.createElement(Svg, {
    "data-testid": "connection"
  }, React.createElement(Path, {
    styles: props.styles,
    d: path
  }));
}
function _createForOfIteratorHelper$1(r2, e) {
  var t = "undefined" != typeof Symbol && r2[Symbol.iterator] || r2["@@iterator"];
  if (!t) {
    if (Array.isArray(r2) || (t = _unsupportedIterableToArray$1(r2)) || e && r2 && "number" == typeof r2.length) {
      t && (r2 = t);
      var _n = 0, F2 = function F3() {
      };
      return { s: F2, n: function n() {
        return _n >= r2.length ? { done: true } : { done: false, value: r2[_n++] };
      }, e: function e2(r3) {
        throw r3;
      }, f: F2 };
    }
    throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
  }
  var o2, a2 = true, u2 = false;
  return { s: function s2() {
    t = t.call(r2);
  }, n: function n() {
    var r3 = t.next();
    return a2 = r3.done, r3;
  }, e: function e2(r3) {
    u2 = true, o2 = r3;
  }, f: function f2() {
    try {
      a2 || null == t["return"] || t["return"]();
    } finally {
      if (u2) throw o2;
    }
  } };
}
function _unsupportedIterableToArray$1(r2, a2) {
  if (r2) {
    if ("string" == typeof r2) return _arrayLikeToArray$1(r2, a2);
    var t = {}.toString.call(r2).slice(8, -1);
    return "Object" === t && r2.constructor && (t = r2.constructor.name), "Map" === t || "Set" === t ? Array.from(r2) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray$1(r2, a2) : void 0;
  }
}
function _arrayLikeToArray$1(r2, a2) {
  (null == a2 || a2 > r2.length) && (a2 = r2.length);
  for (var e = 0, n = Array(a2); e < a2; e++) n[e] = r2[e];
  return n;
}
function copyEvent(e) {
  var newEvent = new e.constructor(e.type);
  var current = newEvent;
  while (current = Object.getPrototypeOf(current)) {
    var keys = Object.getOwnPropertyNames(current);
    var _iterator = _createForOfIteratorHelper$1(keys), _step;
    try {
      for (_iterator.s(); !(_step = _iterator.n()).done; ) {
        var k2 = _step.value;
        var item = newEvent[k2];
        if (typeof item === "function") continue;
        Object.defineProperty(newEvent, k2, {
          value: e[k2]
        });
      }
    } catch (err) {
      _iterator.e(err);
    } finally {
      _iterator.f();
    }
  }
  return newEvent;
}
var rootPrefix = "__reactContainer$";
function findReactRoot(element) {
  var current = element;
  while (current) {
    if (current._reactRootContainer || Object.keys(current).some(function(key) {
      return key.startsWith(rootPrefix);
    })) return current;
    current = current.parentElement;
  }
}
function ownKeys$1(e, r2) {
  var t = Object.keys(e);
  if (Object.getOwnPropertySymbols) {
    var o2 = Object.getOwnPropertySymbols(e);
    r2 && (o2 = o2.filter(function(r3) {
      return Object.getOwnPropertyDescriptor(e, r3).enumerable;
    })), t.push.apply(t, o2);
  }
  return t;
}
function _objectSpread$1(e) {
  for (var r2 = 1; r2 < arguments.length; r2++) {
    var t = null != arguments[r2] ? arguments[r2] : {};
    r2 % 2 ? ownKeys$1(Object(t), true).forEach(function(r3) {
      _defineProperty(e, r3, t[r3]);
    }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys$1(Object(t)).forEach(function(r3) {
      Object.defineProperty(e, r3, Object.getOwnPropertyDescriptor(t, r3));
    });
  }
  return e;
}
function useDrag(translate, getPointer) {
  return {
    start: function start(e) {
      var previous = _objectSpread$1({}, getPointer(e));
      function move(moveEvent) {
        var current = _objectSpread$1({}, getPointer(moveEvent));
        var dx = current.x - previous.x;
        var dy = current.y - previous.y;
        previous = current;
        translate(dx, dy);
      }
      function up() {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    }
  };
}
function useNoDrag(ref, disabled) {
  React.useEffect(function() {
    var handleClick = function handleClick2(e) {
      if (disabled) return;
      var root = findReactRoot(e.target);
      var target = React.version.startsWith("16") ? document : root;
      if (target) {
        e.stopPropagation();
        target.dispatchEvent(copyEvent(e));
      }
    };
    var el = ref.current;
    el === null || el === void 0 ? void 0 : el.addEventListener("pointerdown", handleClick);
    return function() {
      el === null || el === void 0 ? void 0 : el.removeEventListener("pointerdown", handleClick);
    };
  }, [ref, disabled]);
}
function NoDrag(props) {
  var ref = React.useRef(null);
  useNoDrag(ref, props.disabled);
  return React.createElement("span", {
    ref
  }, props.children);
}
var drag = Object.freeze({
  __proto__: null,
  useDrag,
  useNoDrag,
  NoDrag
});
var _templateObject$a;
var Input = dt.input(_templateObject$a || (_templateObject$a = _taggedTemplateLiteral(["\n  width: 100%;\n  border-radius: 30px;\n  background-color: white;\n  padding: 2px 6px;\n  border: 1px solid #999;\n  font-size: 110%;\n  box-sizing: border-box;\n  ", "\n"])), function(props) {
  var _props$styles;
  return (_props$styles = props.styles) === null || _props$styles === void 0 ? void 0 : _props$styles.call(props, props);
});
function Control(props) {
  var _React$useState = React.useState(props.data.value), _React$useState2 = _slicedToArray(_React$useState, 2), value = _React$useState2[0], setValue = _React$useState2[1];
  var ref = React.useRef(null);
  useNoDrag(ref);
  React.useEffect(function() {
    setValue(props.data.value);
  }, [props.data.value]);
  return React.createElement(Input, {
    value,
    type: props.data.type,
    ref,
    readOnly: props.data.readonly,
    onChange: function onChange(e) {
      var val = props.data.type === "number" ? +e.target.value : e.target.value;
      setValue(val);
      props.data.setValue(val);
    },
    styles: props.styles
  });
}
var $nodecolor = "rgba(110,136,255,0.8)";
var $nodecolorselected = "#ffd92c";
var $socketsize = 24;
var $socketmargin = 6;
var $socketcolor = "#96b38a";
var $nodewidth = 180;
var vars = Object.freeze({
  __proto__: null,
  $nodecolor,
  $nodecolorselected,
  $socketsize,
  $socketmargin,
  $socketcolor,
  $nodewidth
});
var _excluded$2 = ["init", "unmount"];
function RefComponent(_ref) {
  var init = _ref.init, unmount = _ref.unmount, props = _objectWithoutProperties(_ref, _excluded$2);
  var ref = React.useRef(null);
  React.useEffect(function() {
    var element = ref.current;
    return function() {
      if (element) unmount(element);
    };
  }, []);
  React.useEffect(function() {
    if (ref.current) init(ref.current);
  });
  return React.createElement("span", _extends({}, props, {
    ref
  }));
}
var _excluded$1 = ["name", "emit", "payload"];
function RefControl(_ref) {
  var name = _ref.name, emit = _ref.emit, payload = _ref.payload, props = _objectWithoutProperties(_ref, _excluded$1);
  return React.createElement(RefComponent, _extends({}, props, {
    className: name,
    init: function init(ref) {
      emit({
        type: "render",
        data: {
          type: "control",
          element: ref,
          payload
        }
      });
    },
    unmount: function unmount(ref) {
      emit({
        type: "unmount",
        data: {
          element: ref
        }
      });
    }
  }));
}
var _excluded = ["name", "emit", "nodeId", "side", "socketKey", "payload"];
function RefSocket(_ref) {
  var name = _ref.name, emit = _ref.emit, nodeId = _ref.nodeId, side = _ref.side, socketKey = _ref.socketKey, payload = _ref.payload, props = _objectWithoutProperties(_ref, _excluded);
  return React.createElement(RefComponent, _extends({}, props, {
    className: name,
    init: function init(ref) {
      emit({
        type: "render",
        data: {
          type: "socket",
          side,
          key: socketKey,
          nodeId,
          element: ref,
          payload
        }
      });
    },
    unmount: function unmount(ref) {
      emit({
        type: "unmount",
        data: {
          element: ref
        }
      });
    }
  }));
}
var _templateObject$9;
var _templateObject2$2;
var NodeStyles = dt.div(_templateObject$9 || (_templateObject$9 = _taggedTemplateLiteral(["\n    background: ", ";\n    border: 2px solid #4e58bf;\n    border-radius: 10px;\n    cursor: pointer;\n    box-sizing: border-box;\n    width: ", ";\n    height: ", ";\n    padding-bottom: 6px;\n    position: relative;\n    user-select: none;\n    line-height: initial;\n    font-family: Arial;\n\n    &:hover {\n        background: lighten(", ",4%);\n    }\n    ", "\n    .title {\n        color: white;\n        font-family: sans-serif;\n        font-size: 18px;\n        padding: 8px;\n    }\n    .output {\n        text-align: right;\n    }\n    .input {\n        text-align: left;\n    }\n    .output-socket {\n        text-align: right;\n        margin-right: -", "px;\n        display: inline-block;\n    }\n    .input-socket {\n        text-align: left;\n        margin-left: -", "px;\n        display: inline-block;\n    }\n    .input-title,.output-title {\n        vertical-align: middle;\n        color: white;\n        display: inline-block;\n        font-family: sans-serif;\n        font-size: 14px;\n        margin: ", "px;\n        line-height: ", "px;\n    }\n    .input-control {\n        z-index: 1;\n        width: calc(100% - ", "px);\n        vertical-align: middle;\n        display: inline-block;\n    }\n    .control {\n        display: block;\n        padding: ", "px ", "px;\n    }\n    ", "\n"])), $nodecolor, function(props) {
  return Number.isFinite(props.width) ? "".concat(props.width, "px") : "".concat($nodewidth, "px");
}, function(props) {
  return Number.isFinite(props.height) ? "".concat(props.height, "px") : "auto";
}, $nodecolor, function(props) {
  return props.selected && lt(_templateObject2$2 || (_templateObject2$2 = _taggedTemplateLiteral(["\n        background: ", ";\n        border-color: #e3c000;\n    "])), $nodecolorselected);
}, $socketsize / 2 + $socketmargin, $socketsize / 2 + $socketmargin, $socketmargin, $socketsize, $socketsize + 2 * $socketmargin, $socketmargin, $socketsize / 2 + $socketmargin, function(props) {
  var _props$styles;
  return (_props$styles = props.styles) === null || _props$styles === void 0 ? void 0 : _props$styles.call(props, props);
});
function sortByIndex(entries) {
  entries.sort(function(a2, b) {
    var _a$, _b$;
    var ai = ((_a$ = a2[1]) === null || _a$ === void 0 ? void 0 : _a$.index) || 0;
    var bi = ((_b$ = b[1]) === null || _b$ === void 0 ? void 0 : _b$.index) || 0;
    return ai - bi;
  });
}
function Node(props) {
  var inputs = Object.entries(props.data.inputs);
  var outputs = Object.entries(props.data.outputs);
  var controls = Object.entries(props.data.controls);
  var selected = props.data.selected || false;
  var _props$data = props.data, id = _props$data.id, label = _props$data.label, width = _props$data.width, height = _props$data.height;
  sortByIndex(inputs);
  sortByIndex(outputs);
  sortByIndex(controls);
  return React.createElement(NodeStyles, {
    selected,
    width,
    height,
    styles: props.styles,
    "data-testid": "node"
  }, React.createElement("div", {
    className: "title",
    "data-testid": "title"
  }, label), outputs.map(function(_ref) {
    var _ref2 = _slicedToArray(_ref, 2), key = _ref2[0], output = _ref2[1];
    return output && React.createElement("div", {
      className: "output",
      key,
      "data-testid": "output-".concat(key)
    }, React.createElement("div", {
      className: "output-title",
      "data-testid": "output-title"
    }, output.label), React.createElement(RefSocket, {
      name: "output-socket",
      side: "output",
      socketKey: key,
      nodeId: id,
      emit: props.emit,
      payload: output.socket,
      "data-testid": "output-socket"
    }));
  }), controls.map(function(_ref3) {
    var _ref4 = _slicedToArray(_ref3, 2), key = _ref4[0], control = _ref4[1];
    return control ? React.createElement(RefControl, {
      key,
      name: "control",
      emit: props.emit,
      payload: control,
      "data-testid": "control-".concat(key)
    }) : null;
  }), inputs.map(function(_ref5) {
    var _ref6 = _slicedToArray(_ref5, 2), key = _ref6[0], input = _ref6[1];
    return input && React.createElement("div", {
      className: "input",
      key,
      "data-testid": "input-".concat(key)
    }, React.createElement(RefSocket, {
      name: "input-socket",
      side: "input",
      socketKey: key,
      nodeId: id,
      emit: props.emit,
      payload: input.socket,
      "data-testid": "input-socket"
    }), input && (!input.control || !input.showControl) && React.createElement("div", {
      className: "input-title",
      "data-testid": "input-title"
    }, input.label), input.control && input.showControl && React.createElement(RefControl, {
      key,
      name: "input-control",
      emit: props.emit,
      payload: input.control,
      "data-testid": "input-control"
    }));
  }));
}
var _templateObject$8;
var _templateObject2$1;
var Styles$4 = dt.div(_templateObject$8 || (_templateObject$8 = _taggedTemplateLiteral(["\n    display: inline-block;\n    cursor: pointer;\n    border: 1px solid white;\n    border-radius: ", "px;\n    width: ", "px;\n    height: ", "px;\n    vertical-align: middle;\n    background: ", ";\n    z-index: 2;\n    box-sizing: border-box;\n    &:hover {\n      border-width: 4px;\n    }\n    &.multiple {\n      border-color: yellow;\n    }\n"])), $socketsize / 2, $socketsize, $socketsize, $socketcolor);
var Hoverable = dt.div(_templateObject2$1 || (_templateObject2$1 = _taggedTemplateLiteral(["\n    border-radius: ", "px;\n    padding: ", "px;\n    &:hover ", " {\n      border-width: 4px;\n    }\n"])), ($socketsize + $socketmargin * 2) / 2, $socketmargin, Styles$4);
function Socket(props) {
  return React.createElement(Hoverable, null, React.createElement(Styles$4, {
    title: props.data.name
  }));
}
function setup$3(props) {
  var positionWatcher = typeof (props === null || props === void 0 ? void 0 : props.socketPositionWatcher) === "undefined" ? getDOMSocketPosition() : props.socketPositionWatcher;
  var _ref = (props === null || props === void 0 ? void 0 : props.customize) || {}, node2 = _ref.node, connection = _ref.connection, socket = _ref.socket, control = _ref.control;
  return {
    attach: function attach(plugin) {
      positionWatcher.attach(plugin);
    },
    // eslint-disable-next-line complexity
    render: function render2(context, plugin) {
      if (context.data.type === "node") {
        var parent = plugin.parentScope();
        var Component = node2 ? node2(context.data) : Node;
        return Component && React.createElement(Component, {
          data: context.data.payload,
          emit: function emit(data) {
            return void parent.emit(data);
          }
        });
      } else if (context.data.type === "connection") {
        var _Component = connection ? connection(context.data) : Connection;
        var payload = context.data.payload;
        var sourceOutput = payload.sourceOutput, targetInput = payload.targetInput, source = payload.source, target = payload.target;
        return _Component && React.createElement(ConnectionWrapper, {
          start: context.data.start || function(change) {
            return positionWatcher.listen(source, "output", sourceOutput, change);
          },
          end: context.data.end || function(change) {
            return positionWatcher.listen(target, "input", targetInput, change);
          },
          path: (function() {
            var _ref2 = _asyncToGenerator(import_regenerator2.default.mark(function _callee(start, end) {
              var response, _response$data, path, points, curvature;
              return import_regenerator2.default.wrap(function(_context) {
                while (1) switch (_context.prev = _context.next) {
                  case 0:
                    _context.next = 1;
                    return plugin.emit({
                      type: "connectionpath",
                      data: {
                        payload,
                        points: [start, end]
                      }
                    });
                  case 1:
                    response = _context.sent;
                    if (response) {
                      _context.next = 2;
                      break;
                    }
                    return _context.abrupt("return", "");
                  case 2:
                    _response$data = response.data, path = _response$data.path, points = _response$data.points;
                    curvature = 0.3;
                    if (!(!path && points.length !== 2)) {
                      _context.next = 3;
                      break;
                    }
                    throw new Error("cannot render connection with a custom number of points");
                  case 3:
                    if (path) {
                      _context.next = 4;
                      break;
                    }
                    return _context.abrupt("return", payload.isLoop ? loopConnectionPath(points, curvature, 120) : classicConnectionPath(points, curvature));
                  case 4:
                    return _context.abrupt("return", path);
                  case 5:
                  case "end":
                    return _context.stop();
                }
              }, _callee);
            }));
            return function(_x, _x2) {
              return _ref2.apply(this, arguments);
            };
          })()
        }, React.createElement(_Component, {
          data: context.data.payload
        }));
      } else if (context.data.type === "socket") {
        var _Component2 = socket ? socket(context.data) : Socket;
        return _Component2 && context.data.payload && React.createElement(_Component2, {
          data: context.data.payload
        });
      } else if (context.data.type === "control") {
        var _Component3 = control && context.data.payload ? control(context.data) : context.data.payload instanceof classic.InputControl ? Control : null;
        return _Component3 && React.createElement(_Component3, {
          data: context.data.payload
        });
      }
    }
  };
}
var index$4 = Object.freeze({
  __proto__: null,
  vars,
  setup: setup$3,
  Connection,
  useConnection,
  Control,
  InputControl: Control,
  Node,
  NodeStyles,
  RefControl,
  RefSocket,
  Socket
});
function useDebounce(cb, timeout) {
  var ref = (0, import_react2.useRef)(void 0);
  function cancel() {
    if (ref.current) {
      clearTimeout(ref.current);
    }
  }
  var func = function func2() {
    cancel();
    ref.current = setTimeout(function() {
      cb();
    }, timeout);
  };
  (0, import_react2.useEffect)(function() {
    return cancel;
  }, []);
  return [func, cancel];
}
var $contextColor = "rgba(110,136,255,0.8)";
var $contextColorLight = "rgba(130, 153, 255, 0.8)";
var $contextColorDark = "rgba(69, 103, 255, 0.8)";
var $contextMenuRound = "5px";
var $width = 120;
var _templateObject$7;
var CommonStyle = dt.div(_templateObject$7 || (_templateObject$7 = _taggedTemplateLiteral(["\n  color: #fff;\n  padding: 4px;\n  border-bottom: 1px solid ", ";\n  background-color: ", ";\n  cursor: pointer;\n  width: 100%;\n  position: relative;\n  &:first-child {\n    border-top-left-radius: ", ";\n    border-top-right-radius: ", ";\n  }\n  &:last-child {\n    border-bottom-left-radius: ", ";\n    border-bottom-right-radius: ", ";\n  }\n  &:hover {\n    background-color: ", ";\n  }\n"])), $contextColorDark, $contextColor, $contextMenuRound, $contextMenuRound, $contextMenuRound, $contextMenuRound, $contextColorLight);
var _templateObject$6;
var _templateObject2;
var _templateObject3;
var ItemStyle = dt(CommonStyle)(_templateObject$6 || (_templateObject$6 = _taggedTemplateLiteral(["\n    ", "\n"])), function(props) {
  return props.hasSubitems && lt(_templateObject2 || (_templateObject2 = _taggedTemplateLiteral(["&:after {\n    content: '►';\n    position: absolute;\n    opacity: 0.6;\n    right: 5px;\n    top: 5px;\n    }"])));
});
var SubitemStyles = dt.div(_templateObject3 || (_templateObject3 = _taggedTemplateLiteral(["\n    position: absolute;\n    top: 0;\n    left: 100%;\n    width: ", "px;\n"])), $width);
function ItemElement(props) {
  var _props$components, _props$components$ite, _props$components2, _props$components2$su;
  var _React$useState = React.useState(false), _React$useState2 = _slicedToArray(_React$useState, 2), visibleSubitems = _React$useState2[0], setVisibleSubitems = _React$useState2[1];
  var setInvisibile = React.useCallback(function() {
    setVisibleSubitems(false);
  }, [setVisibleSubitems]);
  var _useDebounce = useDebounce(setInvisibile, props.delay), _useDebounce2 = _slicedToArray(_useDebounce, 2), hide = _useDebounce2[0], cancelHide = _useDebounce2[1];
  var Component = ((_props$components = props.components) === null || _props$components === void 0 ? void 0 : (_props$components$ite = _props$components.item) === null || _props$components$ite === void 0 ? void 0 : _props$components$ite.call(_props$components, props.data)) || ItemStyle;
  var Subitems = ((_props$components2 = props.components) === null || _props$components2 === void 0 ? void 0 : (_props$components2$su = _props$components2.subitems) === null || _props$components2$su === void 0 ? void 0 : _props$components2$su.call(_props$components2, props.data)) || SubitemStyles;
  return React.createElement(Component, {
    onClick: function onClick(e) {
      e.stopPropagation();
      props.data.handler();
      props.hide();
    },
    hasSubitems: Boolean(props.data.subitems),
    onPointerDown: function onPointerDown(e) {
      e.stopPropagation();
    },
    onPointerOver: function onPointerOver() {
      cancelHide();
      setVisibleSubitems(true);
    },
    onPointerLeave: function onPointerLeave() {
      if (hide) hide();
    },
    "data-testid": "context-menu-item"
  }, props.children, props.data.subitems && visibleSubitems && React.createElement(Subitems, null, props.data.subitems.map(function(item) {
    return React.createElement(ItemElement, {
      key: item.key,
      data: item,
      delay: props.delay,
      hide: props.hide,
      components: props.components
    }, item.label);
  })));
}
var _templateObject$5;
var SearchInput = dt.input(_templateObject$5 || (_templateObject$5 = _taggedTemplateLiteral(["\n  color: white;\n  padding: 1px 8px;\n  border: 1px solid white;\n  border-radius: 10px;\n  font-size: 16px;\n  font-family: serif;\n  width: 100%;\n  box-sizing: border-box;\n  background: transparent;\n"])));
function Search(props) {
  var Component = props.component || SearchInput;
  return React.createElement(Component, {
    value: props.value,
    onInput: function onInput(e) {
      props.onChange(e.target.value);
    },
    onPointerDown: function onPointerDown(e) {
      e.stopPropagation();
    },
    "data-testid": "context-menu-search-input"
  });
}
var _templateObject$4;
var Styles$3 = dt.div(_templateObject$4 || (_templateObject$4 = _taggedTemplateLiteral(["\n  padding: 10px;\n  width: ", "px;\n  margin-top: -20px;\n  margin-left: -", "px;\n"])), $width, $width / 2);
function Menu(props) {
  var _props$components, _props$components$mai, _props$components2, _props$components2$co, _props$components3, _props$components3$se;
  var _useDebounce = useDebounce(props.onHide, props.delay), _useDebounce2 = _slicedToArray(_useDebounce, 2), hide = _useDebounce2[0], cancelHide = _useDebounce2[1];
  var _React$useState = React.useState(""), _React$useState2 = _slicedToArray(_React$useState, 2), filter2 = _React$useState2[0], setFilter = _React$useState2[1];
  var filterRegexp = new RegExp(filter2, "i");
  var filteredList = props.items.filter(function(item) {
    return item.label.match(filterRegexp);
  });
  var Component = ((_props$components = props.components) === null || _props$components === void 0 ? void 0 : (_props$components$mai = _props$components.main) === null || _props$components$mai === void 0 ? void 0 : _props$components$mai.call(_props$components)) || Styles$3;
  var Common = ((_props$components2 = props.components) === null || _props$components2 === void 0 ? void 0 : (_props$components2$co = _props$components2.common) === null || _props$components2$co === void 0 ? void 0 : _props$components2$co.call(_props$components2)) || CommonStyle;
  return React.createElement(Component, {
    onMouseOver: function onMouseOver() {
      cancelHide();
    },
    onMouseLeave: function onMouseLeave() {
      hide === null || hide === void 0 ? void 0 : hide();
    },
    onWheel: function onWheel(e) {
      e.stopPropagation();
    },
    "data-testid": "context-menu"
  }, props.searchBar && React.createElement(Common, null, React.createElement(Search, {
    value: filter2,
    onChange: setFilter,
    component: (_props$components3 = props.components) === null || _props$components3 === void 0 ? void 0 : (_props$components3$se = _props$components3.search) === null || _props$components3$se === void 0 ? void 0 : _props$components3$se.call(_props$components3)
  })), filteredList.map(function(item) {
    return React.createElement(ItemElement, {
      key: item.key,
      data: item,
      delay: props.delay,
      hide: props.onHide,
      components: props.components
    }, item.label);
  }));
}
function setup$2(props) {
  var delay = typeof (props === null || props === void 0 ? void 0 : props.delay) === "undefined" ? 1e3 : props.delay;
  return {
    render: function render2(context) {
      if (context.data.type === "contextmenu") {
        return React.createElement(Menu, {
          items: context.data.items,
          delay,
          searchBar: context.data.searchBar,
          onHide: context.data.onHide,
          components: props === null || props === void 0 ? void 0 : props.customize
        });
      }
    }
  };
}
var index$3 = Object.freeze({
  __proto__: null,
  setup: setup$2,
  Item: ItemStyle,
  Subitems: SubitemStyles,
  Menu: Styles$3,
  Search: SearchInput,
  Common: CommonStyle
});
var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
var freeGlobal = typeof commonjsGlobal == "object" && commonjsGlobal && commonjsGlobal.Object === Object && commonjsGlobal;
var freeSelf = typeof self == "object" && self && self.Object === Object && self;
freeGlobal || freeSelf || Function("return this")();
function useIsMounted() {
  const isMounted = (0, import_react2.useRef)(false);
  (0, import_react2.useEffect)(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);
  return (0, import_react2.useCallback)(() => isMounted.current, []);
}
var initialSize = {
  width: void 0,
  height: void 0
};
function useResizeObserver(options) {
  const { ref, box = "content-box" } = options;
  const [{ width, height }, setSize] = (0, import_react2.useState)(initialSize);
  const isMounted = useIsMounted();
  const previousSize = (0, import_react2.useRef)({ ...initialSize });
  const onResize = (0, import_react2.useRef)(void 0);
  onResize.current = options.onResize;
  (0, import_react2.useEffect)(() => {
    if (!ref.current)
      return;
    if (typeof window === "undefined" || !("ResizeObserver" in window))
      return;
    const observer = new ResizeObserver(([entry]) => {
      const boxProp = box === "border-box" ? "borderBoxSize" : box === "device-pixel-content-box" ? "devicePixelContentBoxSize" : "contentBoxSize";
      const newWidth = extractSize(entry, boxProp, "inlineSize");
      const newHeight = extractSize(entry, boxProp, "blockSize");
      const hasChanged = previousSize.current.width !== newWidth || previousSize.current.height !== newHeight;
      if (hasChanged) {
        const newSize = { width: newWidth, height: newHeight };
        previousSize.current.width = newWidth;
        previousSize.current.height = newHeight;
        if (onResize.current) {
          onResize.current(newSize);
        } else {
          if (isMounted()) {
            setSize(newSize);
          }
        }
      }
    });
    observer.observe(ref.current, { box });
    return () => {
      observer.disconnect();
    };
  }, [box, ref, isMounted]);
  return { width, height };
}
function extractSize(entry, box, sizeType) {
  if (!entry[box]) {
    if (box === "contentBoxSize") {
      return entry.contentRect[sizeType === "inlineSize" ? "width" : "height"];
    }
    return void 0;
  }
  return Array.isArray(entry[box]) ? entry[box][0][sizeType] : (
    // @ts-ignore Support Firefox's non-standard behavior
    entry[box][sizeType]
  );
}
function px(value) {
  return "".concat(value, "px");
}
var _templateObject$3;
var Styles$2 = dt.div(_templateObject$3 || (_templateObject$3 = _taggedTemplateLiteral(["\n    position: absolute;\n    background: rgba(110, 136, 255, 0.8);\n    border: 1px solid rgb(192 206 212 / 60%);\n"])));
function MiniNode(props) {
  return React.createElement(Styles$2, {
    style: {
      left: px(props.left),
      top: px(props.top),
      width: px(props.width),
      height: px(props.height)
    },
    "data-testid": "minimap-node"
  });
}
var _templateObject$2;
var MiniViewportStyles = dt.div(_templateObject$2 || (_templateObject$2 = _taggedTemplateLiteral(["\n  position: absolute;\n  background: rgba(255, 251, 128, 0.32);\n  border: 1px solid #ffe52b;\n"])));
function MiniViewport(props) {
  var scale = function scale2(v2) {
    return v2 * props.containerWidth;
  };
  var invert = function invert2(v2) {
    return v2 / props.containerWidth;
  };
  var drag2 = useDrag(function(dx, dy) {
    props.translate(invert(-dx), invert(-dy));
  }, function(e) {
    return {
      x: e.pageX,
      y: e.pageY
    };
  });
  return React.createElement(MiniViewportStyles, {
    onPointerDown: drag2.start,
    style: {
      left: px(scale(props.left)),
      top: px(scale(props.top)),
      width: px(scale(props.width)),
      height: px(scale(props.height))
    },
    "data-testid": "minimap-viewport"
  });
}
var _templateObject$1;
var Styles$1 = dt.div(_templateObject$1 || (_templateObject$1 = _taggedTemplateLiteral(["\n    position: absolute;\n    right: 24px;\n    bottom: 24px;\n    background: rgba(229, 234, 239, 0.65);\n    padding: 20px;\n    overflow: hidden;\n    border: 1px solid #b1b7ff;\n    border-radius: 8px;\n    box-sizing: border-box;\n"])));
function Minimap(props) {
  var _ref$current;
  var ref = (0, import_react2.useRef)(null);
  var _useResizeObserver = useResizeObserver({
    // https://github.com/juliencrn/usehooks-ts/issues/663
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    ref
  }), _useResizeObserver$wi = _useResizeObserver.width, width = _useResizeObserver$wi === void 0 ? 0 : _useResizeObserver$wi;
  var containerWidth = ((_ref$current = ref.current) === null || _ref$current === void 0 ? void 0 : _ref$current.clientWidth) || width;
  var scale = (0, import_react2.useCallback)(function(v2) {
    return v2 * containerWidth;
  }, [containerWidth]);
  return React.createElement(Styles$1, {
    size: props.size,
    style: {
      width: px(props.size * props.ratio),
      height: px(props.size)
    },
    onPointerDown: function onPointerDown(e) {
      e.stopPropagation();
      e.preventDefault();
    },
    onDoubleClick: function onDoubleClick(e) {
      e.stopPropagation();
      e.preventDefault();
      if (!ref.current) return;
      var box = ref.current.getBoundingClientRect();
      var x2 = (e.clientX - box.left) / (props.size * props.ratio);
      var y2 = (e.clientY - box.top) / (props.size * props.ratio);
      props.point(x2, y2);
    },
    ref,
    "data-testid": "minimap"
  }, containerWidth ? props.nodes.map(function(node2, i2) {
    return React.createElement(MiniNode, {
      key: i2,
      left: scale(node2.left),
      top: scale(node2.top),
      width: scale(node2.width),
      height: scale(node2.height)
    });
  }) : null, React.createElement(MiniViewport, _extends({}, props.viewport, {
    start: props.start,
    containerWidth,
    translate: props.translate
  })));
}
function setup$1(props) {
  return {
    render: function render2(context) {
      if (context.data.type === "minimap") {
        return React.createElement(Minimap, {
          nodes: context.data.nodes,
          size: (props === null || props === void 0 ? void 0 : props.size) || 200,
          ratio: context.data.ratio,
          viewport: context.data.viewport,
          start: context.data.start,
          translate: context.data.translate,
          point: context.data.point
        });
      }
    }
  };
}
var index$2 = Object.freeze({
  __proto__: null,
  setup: setup$1
});
var _templateObject;
var pinSize = 20;
var Styles = dt.div(_templateObject || (_templateObject = _taggedTemplateLiteral(["\n  width: ", "px;\n  height: ", "px;\n  box-sizing: border-box;\n  background: ", ";\n  border: 2px solid white;\n  border-radius: ", "px;\n"])), pinSize, pinSize, function(props) {
  return props.selected ? "#ffd92c" : "steelblue";
}, pinSize);
function Pin(props) {
  var drag2 = useDrag(function(dx, dy) {
    props.translate(dx, dy);
  }, props.pointer);
  var _props$position = props.position, x2 = _props$position.x, y2 = _props$position.y;
  return React.createElement(Styles, {
    onPointerDown: function onPointerDown(e) {
      e.stopPropagation();
      e.preventDefault();
      drag2.start(e);
      props.pointerdown();
    },
    onContextMenu: function onContextMenu(e) {
      e.stopPropagation();
      e.preventDefault();
      props.contextMenu();
    },
    selected: props.selected,
    style: {
      position: "absolute",
      top: "".concat(y2 - pinSize / 2, "px"),
      left: "".concat(x2 - pinSize / 2, "px")
    },
    "data-testid": "pin"
  });
}
function setup(props) {
  function renderPins(data, pointer) {
    return React.createElement(React.Fragment, null, data.pins.map(function(pin) {
      return React.createElement(Pin, _extends({}, pin, {
        key: pin.id,
        contextMenu: function contextMenu() {
          var _props$contextMenu;
          props === null || props === void 0 ? void 0 : (_props$contextMenu = props.contextMenu) === null || _props$contextMenu === void 0 ? void 0 : _props$contextMenu.call(props, pin.id);
        },
        translate: function translate(dx, dy) {
          var _props$translate;
          props === null || props === void 0 ? void 0 : (_props$translate = props.translate) === null || _props$translate === void 0 ? void 0 : _props$translate.call(props, pin.id, dx, dy);
        },
        pointerdown: function pointerdown() {
          var _props$pointerdown;
          props === null || props === void 0 ? void 0 : (_props$pointerdown = props.pointerdown) === null || _props$pointerdown === void 0 ? void 0 : _props$pointerdown.call(props, pin.id);
        },
        pointer
      }));
    }));
  }
  return {
    render: function render2(context, plugin) {
      var data = context.data;
      var area = plugin.parentScope(BaseAreaPlugin);
      if (data.type === "reroute-pins") {
        return renderPins(data.data, function() {
          return area.area.pointer;
        });
      }
    }
  };
}
var index$1 = Object.freeze({
  __proto__: null,
  setup
});
var index = Object.freeze({
  __proto__: null,
  classic: index$4,
  contextMenu: index$3,
  minimap: index$2,
  reroute: index$1
});
function _createForOfIteratorHelper(r2, e) {
  var t = "undefined" != typeof Symbol && r2[Symbol.iterator] || r2["@@iterator"];
  if (!t) {
    if (Array.isArray(r2) || (t = _unsupportedIterableToArray(r2)) || e && r2 && "number" == typeof r2.length) {
      t && (r2 = t);
      var _n = 0, F2 = function F3() {
      };
      return { s: F2, n: function n() {
        return _n >= r2.length ? { done: true } : { done: false, value: r2[_n++] };
      }, e: function e2(r3) {
        throw r3;
      }, f: F2 };
    }
    throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
  }
  var o2, a2 = true, u2 = false;
  return { s: function s2() {
    t = t.call(r2);
  }, n: function n() {
    var r3 = t.next();
    return a2 = r3.done, r3;
  }, e: function e2(r3) {
    u2 = true, o2 = r3;
  }, f: function f2() {
    try {
      a2 || null == t["return"] || t["return"]();
    } finally {
      if (u2) throw o2;
    }
  } };
}
function _unsupportedIterableToArray(r2, a2) {
  if (r2) {
    if ("string" == typeof r2) return _arrayLikeToArray(r2, a2);
    var t = {}.toString.call(r2).slice(8, -1);
    return "Object" === t && r2.constructor && (t = r2.constructor.name), "Map" === t || "Set" === t ? Array.from(r2) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r2, a2) : void 0;
  }
}
function _arrayLikeToArray(r2, a2) {
  (null == a2 || a2 > r2.length) && (a2 = r2.length);
  for (var e = 0, n = Array(a2); e < a2; e++) n[e] = r2[e];
  return n;
}
function ownKeys(e, r2) {
  var t = Object.keys(e);
  if (Object.getOwnPropertySymbols) {
    var o2 = Object.getOwnPropertySymbols(e);
    r2 && (o2 = o2.filter(function(r3) {
      return Object.getOwnPropertyDescriptor(e, r3).enumerable;
    })), t.push.apply(t, o2);
  }
  return t;
}
function _objectSpread(e) {
  for (var r2 = 1; r2 < arguments.length; r2++) {
    var t = null != arguments[r2] ? arguments[r2] : {};
    r2 % 2 ? ownKeys(Object(t), true).forEach(function(r3) {
      _defineProperty(e, r3, t[r3]);
    }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r3) {
      Object.defineProperty(e, r3, Object.getOwnPropertyDescriptor(t, r3));
    });
  }
  return e;
}
function _callSuper2(t, o2, e) {
  return o2 = _getPrototypeOf(o2), _possibleConstructorReturn(t, _isNativeReflectConstruct2() ? Reflect.construct(o2, e || [], _getPrototypeOf(t).constructor) : o2.apply(t, e));
}
function _isNativeReflectConstruct2() {
  try {
    var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {
    }));
  } catch (t2) {
  }
  return (_isNativeReflectConstruct2 = function _isNativeReflectConstruct3() {
    return !!t;
  })();
}
function _superPropGet(t, o2, e, r2) {
  var p2 = _get(_getPrototypeOf(1 & r2 ? t.prototype : t), o2, e);
  return 2 & r2 && "function" == typeof p2 ? function(t2) {
    return p2.apply(e, t2);
  } : p2;
}
var ReactPlugin = (function(_Scope) {
  function ReactPlugin2() {
    var _this;
    for (var _len = arguments.length, _ref = new Array(_len), _key = 0; _key < _len; _key++) {
      _ref[_key] = arguments[_key];
    }
    var props = _ref[0];
    _classCallCheck(this, ReactPlugin2);
    _this = _callSuper2(this, ReactPlugin2, ["react-render"]);
    _defineProperty(_this, "presets", []);
    _this.renderer = getRenderer({
      createRoot: props === null || props === void 0 ? void 0 : props.createRoot
    });
    _this.addPipe(function(context) {
      if (!context || _typeof(context) !== "object" || !("type" in context)) return context;
      if (context.type === "unmount") {
        _this.unmount(context.data.element);
      } else if (context.type === "render") {
        if ("filled" in context.data && context.data.filled) {
          return context;
        }
        if (_this.mount(context.data.element, context)) {
          return _objectSpread(_objectSpread({}, context), {}, {
            data: _objectSpread(_objectSpread({}, context.data), {}, {
              filled: true
            })
          });
        }
      }
      return context;
    });
    return _this;
  }
  _inherits(ReactPlugin2, _Scope);
  return _createClass(ReactPlugin2, [{
    key: "setParent",
    value: function setParent(scope) {
      var _this2 = this;
      _superPropGet(ReactPlugin2, "setParent", this, 3)([scope]);
      this.presets.forEach(function(preset) {
        if (preset.attach) preset.attach(_this2);
      });
    }
  }, {
    key: "mount",
    value: function mount(element, context) {
      var parent = this.parentScope();
      var _iterator = _createForOfIteratorHelper(this.presets), _step;
      try {
        for (_iterator.s(); !(_step = _iterator.n()).done; ) {
          var preset = _step.value;
          var result = preset.render(context, this);
          if (!result) continue;
          var reactElement = React.createElement(Root, {
            rendered: function rendered() {
              return void parent.emit({
                type: "rendered",
                data: context.data
              });
            }
          }, result);
          this.renderer.mount(reactElement, element);
          return true;
        }
      } catch (err) {
        _iterator.e(err);
      } finally {
        _iterator.f();
      }
    }
  }, {
    key: "unmount",
    value: function unmount(element) {
      this.renderer.unmount(element);
    }
    /**
     * Adds a preset to the plugin.
     * @param preset Preset that can render nodes, connections and other elements.
     */
  }, {
    key: "addPreset",
    value: function addPreset(preset) {
      var local = preset;
      if (local.attach) local.attach(this);
      this.presets.push(local);
    }
  }]);
})(Scope);
export {
  drag as Drag,
  index as Presets,
  ReactPlugin,
  RefComponent,
  useRete
};
//# sourceMappingURL=rete-react-plugin.js.map
