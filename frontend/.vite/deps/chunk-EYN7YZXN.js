import {
  __commonJS,
  __toESM
} from "./chunk-PLDDJCW6.js";

// node_modules/@babel/runtime/helpers/OverloadYield.js
var require_OverloadYield = __commonJS({
  "node_modules/@babel/runtime/helpers/OverloadYield.js"(exports, module) {
    function _OverloadYield(e, d) {
      this.v = e, this.k = d;
    }
    module.exports = _OverloadYield, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/@babel/runtime/helpers/regeneratorDefine.js
var require_regeneratorDefine = __commonJS({
  "node_modules/@babel/runtime/helpers/regeneratorDefine.js"(exports, module) {
    function _regeneratorDefine(e, r, n, t) {
      var i = Object.defineProperty;
      try {
        i({}, "", {});
      } catch (e2) {
        i = 0;
      }
      module.exports = _regeneratorDefine = function regeneratorDefine(e2, r2, n2, t2) {
        function o(r3, n3) {
          _regeneratorDefine(e2, r3, function(e3) {
            return this._invoke(r3, n3, e3);
          });
        }
        r2 ? i ? i(e2, r2, {
          value: n2,
          enumerable: !t2,
          configurable: !t2,
          writable: !t2
        }) : e2[r2] = n2 : (o("next", 0), o("throw", 1), o("return", 2));
      }, module.exports.__esModule = true, module.exports["default"] = module.exports, _regeneratorDefine(e, r, n, t);
    }
    module.exports = _regeneratorDefine, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/@babel/runtime/helpers/regenerator.js
var require_regenerator = __commonJS({
  "node_modules/@babel/runtime/helpers/regenerator.js"(exports, module) {
    var regeneratorDefine = require_regeneratorDefine();
    function _regenerator() {
      var e, t, r = "function" == typeof Symbol ? Symbol : {}, n = r.iterator || "@@iterator", o = r.toStringTag || "@@toStringTag";
      function i(r2, n2, o2, i2) {
        var c2 = n2 && n2.prototype instanceof Generator ? n2 : Generator, u2 = Object.create(c2.prototype);
        return regeneratorDefine(u2, "_invoke", (function(r3, n3, o3) {
          var i3, c3, u3, f2 = 0, p = o3 || [], y = false, G = {
            p: 0,
            n: 0,
            v: e,
            a: d,
            f: d.bind(e, 4),
            d: function d2(t2, r4) {
              return i3 = t2, c3 = 0, u3 = e, G.n = r4, a;
            }
          };
          function d(r4, n4) {
            for (c3 = r4, u3 = n4, t = 0; !y && f2 && !o4 && t < p.length; t++) {
              var o4, i4 = p[t], d2 = G.p, l = i4[2];
              r4 > 3 ? (o4 = l === n4) && (u3 = i4[(c3 = i4[4]) ? 5 : (c3 = 3, 3)], i4[4] = i4[5] = e) : i4[0] <= d2 && ((o4 = r4 < 2 && d2 < i4[1]) ? (c3 = 0, G.v = n4, G.n = i4[1]) : d2 < l && (o4 = r4 < 3 || i4[0] > n4 || n4 > l) && (i4[4] = r4, i4[5] = n4, G.n = l, c3 = 0));
            }
            if (o4 || r4 > 1) return a;
            throw y = true, n4;
          }
          return function(o4, p2, l) {
            if (f2 > 1) throw TypeError("Generator is already running");
            for (y && 1 === p2 && d(p2, l), c3 = p2, u3 = l; (t = c3 < 2 ? e : u3) || !y; ) {
              i3 || (c3 ? c3 < 3 ? (c3 > 1 && (G.n = -1), d(c3, u3)) : G.n = u3 : G.v = u3);
              try {
                if (f2 = 2, i3) {
                  if (c3 || (o4 = "next"), t = i3[o4]) {
                    if (!(t = t.call(i3, u3))) throw TypeError("iterator result is not an object");
                    if (!t.done) return t;
                    u3 = t.value, c3 < 2 && (c3 = 0);
                  } else 1 === c3 && (t = i3["return"]) && t.call(i3), c3 < 2 && (u3 = TypeError("The iterator does not provide a '" + o4 + "' method"), c3 = 1);
                  i3 = e;
                } else if ((t = (y = G.n < 0) ? u3 : r3.call(n3, G)) !== a) break;
              } catch (t2) {
                i3 = e, c3 = 1, u3 = t2;
              } finally {
                f2 = 1;
              }
            }
            return {
              value: t,
              done: y
            };
          };
        })(r2, o2, i2), true), u2;
      }
      var a = {};
      function Generator() {
      }
      function GeneratorFunction() {
      }
      function GeneratorFunctionPrototype() {
      }
      t = Object.getPrototypeOf;
      var c = [][n] ? t(t([][n]())) : (regeneratorDefine(t = {}, n, function() {
        return this;
      }), t), u = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(c);
      function f(e2) {
        return Object.setPrototypeOf ? Object.setPrototypeOf(e2, GeneratorFunctionPrototype) : (e2.__proto__ = GeneratorFunctionPrototype, regeneratorDefine(e2, o, "GeneratorFunction")), e2.prototype = Object.create(u), e2;
      }
      return GeneratorFunction.prototype = GeneratorFunctionPrototype, regeneratorDefine(u, "constructor", GeneratorFunctionPrototype), regeneratorDefine(GeneratorFunctionPrototype, "constructor", GeneratorFunction), GeneratorFunction.displayName = "GeneratorFunction", regeneratorDefine(GeneratorFunctionPrototype, o, "GeneratorFunction"), regeneratorDefine(u), regeneratorDefine(u, o, "Generator"), regeneratorDefine(u, n, function() {
        return this;
      }), regeneratorDefine(u, "toString", function() {
        return "[object Generator]";
      }), (module.exports = _regenerator = function _regenerator2() {
        return {
          w: i,
          m: f
        };
      }, module.exports.__esModule = true, module.exports["default"] = module.exports)();
    }
    module.exports = _regenerator, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/@babel/runtime/helpers/regeneratorAsyncIterator.js
var require_regeneratorAsyncIterator = __commonJS({
  "node_modules/@babel/runtime/helpers/regeneratorAsyncIterator.js"(exports, module) {
    var OverloadYield = require_OverloadYield();
    var regeneratorDefine = require_regeneratorDefine();
    function AsyncIterator(t, e) {
      function n(r2, o, i, f) {
        try {
          var c = t[r2](o), u = c.value;
          return u instanceof OverloadYield ? e.resolve(u.v).then(function(t2) {
            n("next", t2, i, f);
          }, function(t2) {
            n("throw", t2, i, f);
          }) : e.resolve(u).then(function(t2) {
            c.value = t2, i(c);
          }, function(t2) {
            return n("throw", t2, i, f);
          });
        } catch (t2) {
          f(t2);
        }
      }
      var r;
      this.next || (regeneratorDefine(AsyncIterator.prototype), regeneratorDefine(AsyncIterator.prototype, "function" == typeof Symbol && Symbol.asyncIterator || "@asyncIterator", function() {
        return this;
      })), regeneratorDefine(this, "_invoke", function(t2, o, i) {
        function f() {
          return new e(function(e2, r2) {
            n(t2, i, e2, r2);
          });
        }
        return r = r ? r.then(f, f) : f();
      }, true);
    }
    module.exports = AsyncIterator, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/@babel/runtime/helpers/regeneratorAsyncGen.js
var require_regeneratorAsyncGen = __commonJS({
  "node_modules/@babel/runtime/helpers/regeneratorAsyncGen.js"(exports, module) {
    var regenerator = require_regenerator();
    var regeneratorAsyncIterator = require_regeneratorAsyncIterator();
    function _regeneratorAsyncGen(r, e, t, o, n) {
      return new regeneratorAsyncIterator(regenerator().w(r, e, t, o), n || Promise);
    }
    module.exports = _regeneratorAsyncGen, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/@babel/runtime/helpers/regeneratorAsync.js
var require_regeneratorAsync = __commonJS({
  "node_modules/@babel/runtime/helpers/regeneratorAsync.js"(exports, module) {
    var regeneratorAsyncGen = require_regeneratorAsyncGen();
    function _regeneratorAsync(n, e, r, t, o) {
      var a = regeneratorAsyncGen(n, e, r, t, o);
      return a.next().then(function(n2) {
        return n2.done ? n2.value : a.next();
      });
    }
    module.exports = _regeneratorAsync, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/@babel/runtime/helpers/regeneratorKeys.js
var require_regeneratorKeys = __commonJS({
  "node_modules/@babel/runtime/helpers/regeneratorKeys.js"(exports, module) {
    function _regeneratorKeys(e) {
      var n = Object(e), r = [];
      for (var t in n) r.unshift(t);
      return function e2() {
        for (; r.length; ) if ((t = r.pop()) in n) return e2.value = t, e2.done = false, e2;
        return e2.done = true, e2;
      };
    }
    module.exports = _regeneratorKeys, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/@babel/runtime/helpers/typeof.js
var require_typeof = __commonJS({
  "node_modules/@babel/runtime/helpers/typeof.js"(exports, module) {
    function _typeof2(o) {
      "@babel/helpers - typeof";
      return module.exports = _typeof2 = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
        return typeof o2;
      } : function(o2) {
        return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
      }, module.exports.__esModule = true, module.exports["default"] = module.exports, _typeof2(o);
    }
    module.exports = _typeof2, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/@babel/runtime/helpers/regeneratorValues.js
var require_regeneratorValues = __commonJS({
  "node_modules/@babel/runtime/helpers/regeneratorValues.js"(exports, module) {
    var _typeof2 = require_typeof()["default"];
    function _regeneratorValues(e) {
      if (null != e) {
        var t = e["function" == typeof Symbol && Symbol.iterator || "@@iterator"], r = 0;
        if (t) return t.call(e);
        if ("function" == typeof e.next) return e;
        if (!isNaN(e.length)) return {
          next: function next() {
            return e && r >= e.length && (e = void 0), {
              value: e && e[r++],
              done: !e
            };
          }
        };
      }
      throw new TypeError(_typeof2(e) + " is not iterable");
    }
    module.exports = _regeneratorValues, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/@babel/runtime/helpers/regeneratorRuntime.js
var require_regeneratorRuntime = __commonJS({
  "node_modules/@babel/runtime/helpers/regeneratorRuntime.js"(exports, module) {
    var OverloadYield = require_OverloadYield();
    var regenerator = require_regenerator();
    var regeneratorAsync = require_regeneratorAsync();
    var regeneratorAsyncGen = require_regeneratorAsyncGen();
    var regeneratorAsyncIterator = require_regeneratorAsyncIterator();
    var regeneratorKeys = require_regeneratorKeys();
    var regeneratorValues = require_regeneratorValues();
    function _regeneratorRuntime2() {
      "use strict";
      var r = regenerator(), e = r.m(_regeneratorRuntime2), t = (Object.getPrototypeOf ? Object.getPrototypeOf(e) : e.__proto__).constructor;
      function n(r2) {
        var e2 = "function" == typeof r2 && r2.constructor;
        return !!e2 && (e2 === t || "GeneratorFunction" === (e2.displayName || e2.name));
      }
      var o = {
        "throw": 1,
        "return": 2,
        "break": 3,
        "continue": 3
      };
      function a(r2) {
        var e2, t2;
        return function(n2) {
          e2 || (e2 = {
            stop: function stop() {
              return t2(n2.a, 2);
            },
            "catch": function _catch() {
              return n2.v;
            },
            abrupt: function abrupt(r3, e3) {
              return t2(n2.a, o[r3], e3);
            },
            delegateYield: function delegateYield(r3, o2, a2) {
              return e2.resultName = o2, t2(n2.d, regeneratorValues(r3), a2);
            },
            finish: function finish(r3) {
              return t2(n2.f, r3);
            }
          }, t2 = function t3(r3, _t, o2) {
            n2.p = e2.prev, n2.n = e2.next;
            try {
              return r3(_t, o2);
            } finally {
              e2.next = n2.n;
            }
          }), e2.resultName && (e2[e2.resultName] = n2.v, e2.resultName = void 0), e2.sent = n2.v, e2.next = n2.n;
          try {
            return r2.call(this, e2);
          } finally {
            n2.p = e2.prev, n2.n = e2.next;
          }
        };
      }
      return (module.exports = _regeneratorRuntime2 = function _regeneratorRuntime3() {
        return {
          wrap: function wrap(e2, t2, n2, o2) {
            return r.w(a(e2), t2, n2, o2 && o2.reverse());
          },
          isGeneratorFunction: n,
          mark: r.m,
          awrap: function awrap(r2, e2) {
            return new OverloadYield(r2, e2);
          },
          AsyncIterator: regeneratorAsyncIterator,
          async: function async(r2, e2, t2, o2, u) {
            return (n(e2) ? regeneratorAsyncGen : regeneratorAsync)(a(r2), e2, t2, o2, u);
          },
          keys: regeneratorKeys,
          values: regeneratorValues
        };
      }, module.exports.__esModule = true, module.exports["default"] = module.exports)();
    }
    module.exports = _regeneratorRuntime2, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/@babel/runtime/regenerator/index.js
var require_regenerator2 = __commonJS({
  "node_modules/@babel/runtime/regenerator/index.js"(exports, module) {
    var runtime = require_regeneratorRuntime()();
    module.exports = runtime;
    try {
      regeneratorRuntime = runtime;
    } catch (accidentalStrictMode) {
      if (typeof globalThis === "object") {
        globalThis.regeneratorRuntime = runtime;
      } else {
        Function("r", "regeneratorRuntime = r")(runtime);
      }
    }
  }
});

// node_modules/@babel/runtime/helpers/esm/asyncToGenerator.js
function asyncGeneratorStep(n, t, e, r, o, a, c) {
  try {
    var i = n[a](c), u = i.value;
  } catch (n2) {
    return void e(n2);
  }
  i.done ? t(u) : Promise.resolve(u).then(r, o);
}
function _asyncToGenerator(n) {
  return function() {
    var t = this, e = arguments;
    return new Promise(function(r, o) {
      var a = n.apply(t, e);
      function _next(n2) {
        asyncGeneratorStep(a, r, o, _next, _throw, "next", n2);
      }
      function _throw(n2) {
        asyncGeneratorStep(a, r, o, _next, _throw, "throw", n2);
      }
      _next(void 0);
    });
  };
}

// node_modules/@babel/runtime/helpers/esm/classCallCheck.js
function _classCallCheck(a, n) {
  if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
}

// node_modules/@babel/runtime/helpers/esm/typeof.js
function _typeof(o) {
  "@babel/helpers - typeof";
  return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
    return typeof o2;
  } : function(o2) {
    return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
  }, _typeof(o);
}

// node_modules/@babel/runtime/helpers/esm/toPrimitive.js
function toPrimitive(t, r) {
  if ("object" != _typeof(t) || !t) return t;
  var e = t[Symbol.toPrimitive];
  if (void 0 !== e) {
    var i = e.call(t, r || "default");
    if ("object" != _typeof(i)) return i;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return ("string" === r ? String : Number)(t);
}

// node_modules/@babel/runtime/helpers/esm/toPropertyKey.js
function toPropertyKey(t) {
  var i = toPrimitive(t, "string");
  return "symbol" == _typeof(i) ? i : i + "";
}

// node_modules/@babel/runtime/helpers/esm/createClass.js
function _defineProperties(e, r) {
  for (var t = 0; t < r.length; t++) {
    var o = r[t];
    o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, toPropertyKey(o.key), o);
  }
}
function _createClass(e, r, t) {
  return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", {
    writable: false
  }), e;
}

// node_modules/@babel/runtime/helpers/esm/assertThisInitialized.js
function _assertThisInitialized(e) {
  if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  return e;
}

// node_modules/@babel/runtime/helpers/esm/possibleConstructorReturn.js
function _possibleConstructorReturn(t, e) {
  if (e && ("object" == _typeof(e) || "function" == typeof e)) return e;
  if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined");
  return _assertThisInitialized(t);
}

// node_modules/@babel/runtime/helpers/esm/getPrototypeOf.js
function _getPrototypeOf(t) {
  return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function(t2) {
    return t2.__proto__ || Object.getPrototypeOf(t2);
  }, _getPrototypeOf(t);
}

// node_modules/@babel/runtime/helpers/esm/setPrototypeOf.js
function _setPrototypeOf(t, e) {
  return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function(t2, e2) {
    return t2.__proto__ = e2, t2;
  }, _setPrototypeOf(t, e);
}

// node_modules/@babel/runtime/helpers/esm/inherits.js
function _inherits(t, e) {
  if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function");
  t.prototype = Object.create(e && e.prototype, {
    constructor: {
      value: t,
      writable: true,
      configurable: true
    }
  }), Object.defineProperty(t, "prototype", {
    writable: false
  }), e && _setPrototypeOf(t, e);
}

// node_modules/@babel/runtime/helpers/esm/defineProperty.js
function _defineProperty(e, r, t) {
  return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
    value: t,
    enumerable: true,
    configurable: true,
    writable: true
  }) : e[r] = t, e;
}

// node_modules/rete/rete.esm.js
var import_regenerator = __toESM(require_regenerator2());
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
function useHelper() {
  return {
    debug: function debug(_f) {
    }
  };
}
var Signal = (function() {
  function Signal2() {
    _classCallCheck(this, Signal2);
    _defineProperty(this, "pipes", []);
  }
  return _createClass(Signal2, [{
    key: "addPipe",
    value: function addPipe(pipe) {
      this.pipes.push(pipe);
    }
  }, {
    key: "emit",
    value: (function() {
      var _emit = _asyncToGenerator(import_regenerator.default.mark(function _callee(context) {
        var current, _iterator, _step, pipe;
        return import_regenerator.default.wrap(function _callee$(_context) {
          while (1) switch (_context.prev = _context.next) {
            case 0:
              current = context;
              _iterator = _createForOfIteratorHelper$1(this.pipes);
              _context.prev = 2;
              _iterator.s();
            case 4:
              if ((_step = _iterator.n()).done) {
                _context.next = 13;
                break;
              }
              pipe = _step.value;
              _context.next = 8;
              return pipe(current);
            case 8:
              current = _context.sent;
              if (!(typeof current === "undefined")) {
                _context.next = 11;
                break;
              }
              return _context.abrupt("return");
            case 11:
              _context.next = 4;
              break;
            case 13:
              _context.next = 18;
              break;
            case 15:
              _context.prev = 15;
              _context.t0 = _context["catch"](2);
              _iterator.e(_context.t0);
            case 18:
              _context.prev = 18;
              _iterator.f();
              return _context.finish(18);
            case 21:
              return _context.abrupt("return", current);
            case 22:
            case "end":
              return _context.stop();
          }
        }, _callee, this, [[2, 15, 18, 21]]);
      }));
      function emit(_x) {
        return _emit.apply(this, arguments);
      }
      return emit;
    })()
  }]);
})();
var Scope = (function() {
  function Scope2(name) {
    _classCallCheck(this, Scope2);
    _defineProperty(this, "signal", new Signal());
    this.name = name;
  }
  return _createClass(Scope2, [{
    key: "addPipe",
    value: function addPipe(middleware) {
      this.signal.addPipe(middleware);
    }
  }, {
    key: "use",
    value: function use(scope) {
      if (!(scope instanceof Scope2)) throw new Error("cannot use non-Scope instance");
      scope.setParent(this);
      this.addPipe(function(context) {
        return scope.signal.emit(context);
      });
      return useHelper();
    }
  }, {
    key: "setParent",
    value: function setParent(scope) {
      this.parent = scope;
    }
  }, {
    key: "emit",
    value: function emit(context) {
      return this.signal.emit(context);
    }
  }, {
    key: "hasParent",
    value: function hasParent() {
      return Boolean(this.parent);
    }
  }, {
    key: "parentScope",
    value: function parentScope(type) {
      if (!this.parent) throw new Error("cannot find parent");
      if (type && this.parent instanceof type) return this.parent;
      if (type) throw new Error("actual parent is not instance of type");
      return this.parent;
    }
  }]);
})();
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
var NodeEditor = (function(_Scope) {
  function NodeEditor2() {
    var _this;
    _classCallCheck(this, NodeEditor2);
    _this = _callSuper$1(this, NodeEditor2, ["NodeEditor"]);
    _defineProperty(_this, "nodes", []);
    _defineProperty(_this, "connections", []);
    return _this;
  }
  _inherits(NodeEditor2, _Scope);
  return _createClass(NodeEditor2, [{
    key: "getNode",
    value: function getNode(id) {
      return this.nodes.find(function(node) {
        return node.id === id;
      });
    }
    /**
     * Get all nodes
     * @returns Copy of array with nodes
     */
  }, {
    key: "getNodes",
    value: function getNodes() {
      return this.nodes.slice();
    }
    /**
     * Get all connections
     * @returns Copy of array with onnections
     */
  }, {
    key: "getConnections",
    value: function getConnections() {
      return this.connections.slice();
    }
    /**
     * Get a connection by id
     * @param id - The connection id
     * @returns The connection or undefined
     */
  }, {
    key: "getConnection",
    value: function getConnection(id) {
      return this.connections.find(function(connection) {
        return connection.id === id;
      });
    }
    /**
     * Add a node
     * @param data - The node data
     * @returns Whether the node was added
     * @throws If the node has already been added
     * @emits nodecreate
     * @emits nodecreated
     */
  }, {
    key: "addNode",
    value: (function() {
      var _addNode = _asyncToGenerator(import_regenerator.default.mark(function _callee(data) {
        return import_regenerator.default.wrap(function _callee$(_context) {
          while (1) switch (_context.prev = _context.next) {
            case 0:
              if (!this.getNode(data.id)) {
                _context.next = 2;
                break;
              }
              throw new Error("node has already been added");
            case 2:
              _context.next = 4;
              return this.emit({
                type: "nodecreate",
                data
              });
            case 4:
              if (_context.sent) {
                _context.next = 6;
                break;
              }
              return _context.abrupt("return", false);
            case 6:
              this.nodes.push(data);
              _context.next = 9;
              return this.emit({
                type: "nodecreated",
                data
              });
            case 9:
              return _context.abrupt("return", true);
            case 10:
            case "end":
              return _context.stop();
          }
        }, _callee, this);
      }));
      function addNode(_x) {
        return _addNode.apply(this, arguments);
      }
      return addNode;
    })()
  }, {
    key: "addConnection",
    value: (function() {
      var _addConnection = _asyncToGenerator(import_regenerator.default.mark(function _callee2(data) {
        return import_regenerator.default.wrap(function _callee2$(_context2) {
          while (1) switch (_context2.prev = _context2.next) {
            case 0:
              if (!this.getConnection(data.id)) {
                _context2.next = 2;
                break;
              }
              throw new Error("connection has already been added");
            case 2:
              _context2.next = 4;
              return this.emit({
                type: "connectioncreate",
                data
              });
            case 4:
              if (_context2.sent) {
                _context2.next = 6;
                break;
              }
              return _context2.abrupt("return", false);
            case 6:
              this.connections.push(data);
              _context2.next = 9;
              return this.emit({
                type: "connectioncreated",
                data
              });
            case 9:
              return _context2.abrupt("return", true);
            case 10:
            case "end":
              return _context2.stop();
          }
        }, _callee2, this);
      }));
      function addConnection(_x2) {
        return _addConnection.apply(this, arguments);
      }
      return addConnection;
    })()
  }, {
    key: "removeNode",
    value: (function() {
      var _removeNode = _asyncToGenerator(import_regenerator.default.mark(function _callee3(id) {
        var node, index;
        return import_regenerator.default.wrap(function _callee3$(_context3) {
          while (1) switch (_context3.prev = _context3.next) {
            case 0:
              node = this.nodes.find(function(n) {
                return n.id === id;
              });
              if (node) {
                _context3.next = 3;
                break;
              }
              throw new Error("cannot find node");
            case 3:
              _context3.next = 5;
              return this.emit({
                type: "noderemove",
                data: node
              });
            case 5:
              if (_context3.sent) {
                _context3.next = 7;
                break;
              }
              return _context3.abrupt("return", false);
            case 7:
              index = this.nodes.indexOf(node);
              this.nodes.splice(index, 1);
              _context3.next = 11;
              return this.emit({
                type: "noderemoved",
                data: node
              });
            case 11:
              return _context3.abrupt("return", true);
            case 12:
            case "end":
              return _context3.stop();
          }
        }, _callee3, this);
      }));
      function removeNode(_x3) {
        return _removeNode.apply(this, arguments);
      }
      return removeNode;
    })()
  }, {
    key: "removeConnection",
    value: (function() {
      var _removeConnection = _asyncToGenerator(import_regenerator.default.mark(function _callee4(id) {
        var connection, index;
        return import_regenerator.default.wrap(function _callee4$(_context4) {
          while (1) switch (_context4.prev = _context4.next) {
            case 0:
              connection = this.connections.find(function(c) {
                return c.id === id;
              });
              if (connection) {
                _context4.next = 3;
                break;
              }
              throw new Error("cannot find connection");
            case 3:
              _context4.next = 5;
              return this.emit({
                type: "connectionremove",
                data: connection
              });
            case 5:
              if (_context4.sent) {
                _context4.next = 7;
                break;
              }
              return _context4.abrupt("return", false);
            case 7:
              index = this.connections.indexOf(connection);
              this.connections.splice(index, 1);
              _context4.next = 11;
              return this.emit({
                type: "connectionremoved",
                data: connection
              });
            case 11:
              return _context4.abrupt("return", true);
            case 12:
            case "end":
              return _context4.stop();
          }
        }, _callee4, this);
      }));
      function removeConnection(_x4) {
        return _removeConnection.apply(this, arguments);
      }
      return removeConnection;
    })()
  }, {
    key: "clear",
    value: (function() {
      var _clear = _asyncToGenerator(import_regenerator.default.mark(function _callee5() {
        var _iterator, _step, connection, _iterator2, _step2, node;
        return import_regenerator.default.wrap(function _callee5$(_context5) {
          while (1) switch (_context5.prev = _context5.next) {
            case 0:
              _context5.next = 2;
              return this.emit({
                type: "clear"
              });
            case 2:
              if (_context5.sent) {
                _context5.next = 6;
                break;
              }
              _context5.next = 5;
              return this.emit({
                type: "clearcancelled"
              });
            case 5:
              return _context5.abrupt("return", false);
            case 6:
              _iterator = _createForOfIteratorHelper(this.connections.slice());
              _context5.prev = 7;
              _iterator.s();
            case 9:
              if ((_step = _iterator.n()).done) {
                _context5.next = 15;
                break;
              }
              connection = _step.value;
              _context5.next = 13;
              return this.removeConnection(connection.id);
            case 13:
              _context5.next = 9;
              break;
            case 15:
              _context5.next = 20;
              break;
            case 17:
              _context5.prev = 17;
              _context5.t0 = _context5["catch"](7);
              _iterator.e(_context5.t0);
            case 20:
              _context5.prev = 20;
              _iterator.f();
              return _context5.finish(20);
            case 23:
              _iterator2 = _createForOfIteratorHelper(this.nodes.slice());
              _context5.prev = 24;
              _iterator2.s();
            case 26:
              if ((_step2 = _iterator2.n()).done) {
                _context5.next = 32;
                break;
              }
              node = _step2.value;
              _context5.next = 30;
              return this.removeNode(node.id);
            case 30:
              _context5.next = 26;
              break;
            case 32:
              _context5.next = 37;
              break;
            case 34:
              _context5.prev = 34;
              _context5.t1 = _context5["catch"](24);
              _iterator2.e(_context5.t1);
            case 37:
              _context5.prev = 37;
              _iterator2.f();
              return _context5.finish(37);
            case 40:
              _context5.next = 42;
              return this.emit({
                type: "cleared"
              });
            case 42:
              return _context5.abrupt("return", true);
            case 43:
            case "end":
              return _context5.stop();
          }
        }, _callee5, this, [[7, 17, 20, 23], [24, 34, 37, 40]]);
      }));
      function clear() {
        return _clear.apply(this, arguments);
      }
      return clear;
    })()
  }]);
})(Scope);
var crypto = globalThis.crypto;
function getUID() {
  if ("randomBytes" in crypto) {
    return crypto.randomBytes(8).toString("hex");
  }
  var bytes = crypto.getRandomValues(new Uint8Array(8));
  var array = Array.from(bytes);
  var hexPairs = array.map(function(b) {
    return b.toString(16).padStart(2, "0");
  });
  return hexPairs.join("");
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
var Socket = _createClass(
  /**
   * @constructor
   * @param name Name of the socket
   */
  function Socket2(name) {
    _classCallCheck(this, Socket2);
    this.name = name;
  }
);
var Port = _createClass(
  /**
   * Port id, unique string generated by `getUID` function
   */
  /**
   * Port index, used for sorting ports. Default is `0`
   */
  /**
   * @constructor
   * @param socket Socket instance
   * @param label Label of the port
   * @param multipleConnections Whether the output port can have multiple connections
   */
  function Port2(socket, label, multipleConnections) {
    _classCallCheck(this, Port2);
    this.socket = socket;
    this.label = label;
    this.multipleConnections = multipleConnections;
    this.id = getUID();
  }
);
var Input = (function(_Port) {
  function Input2(socket, label, multipleConnections) {
    var _this;
    _classCallCheck(this, Input2);
    _this = _callSuper(this, Input2, [socket, label, multipleConnections]);
    _defineProperty(_this, "control", null);
    _defineProperty(_this, "showControl", true);
    _this.socket = socket;
    _this.label = label;
    _this.multipleConnections = multipleConnections;
    return _this;
  }
  _inherits(Input2, _Port);
  return _createClass(Input2, [{
    key: "addControl",
    value: function addControl(control) {
      if (this.control) throw new Error("control already added for this input");
      this.control = control;
    }
    /**
     * Remove control from the input port
     */
  }, {
    key: "removeControl",
    value: function removeControl() {
      this.control = null;
    }
  }]);
})(Port);
var Output = (function(_Port2) {
  function Output2(socket, label, multipleConnections) {
    _classCallCheck(this, Output2);
    return _callSuper(this, Output2, [socket, label, multipleConnections !== false]);
  }
  _inherits(Output2, _Port2);
  return _createClass(Output2);
})(Port);
var Control = _createClass(
  /**
   * Control id, unique string generated by `getUID` function
   */
  /**
   * Control index, used for sorting controls. Default is `0`
   */
  function Control2() {
    _classCallCheck(this, Control2);
    this.id = getUID();
  }
);
var InputControl = (function(_Control) {
  function InputControl2(type, options) {
    var _options$readonly;
    var _this2;
    _classCallCheck(this, InputControl2);
    _this2 = _callSuper(this, InputControl2);
    _this2.type = type;
    _this2.options = options;
    _this2.id = getUID();
    _this2.readonly = (_options$readonly = options === null || options === void 0 ? void 0 : options.readonly) !== null && _options$readonly !== void 0 ? _options$readonly : false;
    if (typeof (options === null || options === void 0 ? void 0 : options.initial) !== "undefined") _this2.value = options.initial;
    return _this2;
  }
  _inherits(InputControl2, _Control);
  return _createClass(InputControl2, [{
    key: "setValue",
    value: function setValue(value) {
      var _this$options;
      this.value = value;
      if ((_this$options = this.options) !== null && _this$options !== void 0 && _this$options.change) this.options.change(value);
    }
  }]);
})(Control);
var Node = (function() {
  function Node2(label) {
    _classCallCheck(this, Node2);
    _defineProperty(this, "inputs", {});
    _defineProperty(this, "outputs", {});
    _defineProperty(this, "controls", {});
    this.label = label;
    this.id = getUID();
  }
  return _createClass(Node2, [{
    key: "hasInput",
    value: function hasInput(key) {
      return Object.prototype.hasOwnProperty.call(this.inputs, key);
    }
  }, {
    key: "addInput",
    value: function addInput(key, input) {
      if (this.hasInput(key)) throw new Error("input with key '".concat(String(key), "' already added"));
      Object.defineProperty(this.inputs, key, {
        value: input,
        enumerable: true,
        configurable: true
      });
    }
  }, {
    key: "removeInput",
    value: function removeInput(key) {
      delete this.inputs[key];
    }
  }, {
    key: "hasOutput",
    value: function hasOutput(key) {
      return Object.prototype.hasOwnProperty.call(this.outputs, key);
    }
  }, {
    key: "addOutput",
    value: function addOutput(key, output) {
      if (this.hasOutput(key)) throw new Error("output with key '".concat(String(key), "' already added"));
      Object.defineProperty(this.outputs, key, {
        value: output,
        enumerable: true,
        configurable: true
      });
    }
  }, {
    key: "removeOutput",
    value: function removeOutput(key) {
      delete this.outputs[key];
    }
  }, {
    key: "hasControl",
    value: function hasControl(key) {
      return Object.prototype.hasOwnProperty.call(this.controls, key);
    }
  }, {
    key: "addControl",
    value: function addControl(key, control) {
      if (this.hasControl(key)) throw new Error("control with key '".concat(String(key), "' already added"));
      Object.defineProperty(this.controls, key, {
        value: control,
        enumerable: true,
        configurable: true
      });
    }
  }, {
    key: "removeControl",
    value: function removeControl(key) {
      delete this.controls[key];
    }
  }]);
})();
var Connection = _createClass(
  /**
   * Connection id, unique string generated by `getUID` function
   */
  /**
   * Source node id
   */
  /**
   * Target node id
   */
  /**
   * @constructor
   * @param source Source node instance
   * @param sourceOutput Source node output key
   * @param target Target node instance
   * @param targetInput Target node input key
   */
  function Connection2(source, sourceOutput, target, targetInput) {
    _classCallCheck(this, Connection2);
    this.sourceOutput = sourceOutput;
    this.targetInput = targetInput;
    if (!source.outputs[sourceOutput]) {
      throw new Error("source node doesn't have output with a key ".concat(String(sourceOutput)));
    }
    if (!target.inputs[targetInput]) {
      throw new Error("target node doesn't have input with a key ".concat(String(targetInput)));
    }
    this.id = getUID();
    this.source = source.id;
    this.target = target.id;
  }
);
var classic = Object.freeze({
  __proto__: null,
  Socket,
  Port,
  Input,
  Output,
  Control,
  InputControl,
  Node,
  Connection
});

export {
  _asyncToGenerator,
  _classCallCheck,
  _typeof,
  _createClass,
  _possibleConstructorReturn,
  _getPrototypeOf,
  _inherits,
  _defineProperty,
  require_regenerator2 as require_regenerator,
  Signal,
  Scope,
  NodeEditor,
  getUID,
  classic
};
//# sourceMappingURL=chunk-EYN7YZXN.js.map
