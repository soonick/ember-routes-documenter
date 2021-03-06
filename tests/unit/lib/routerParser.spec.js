'use strict';

var assert = require('assert');
var esprima = require('esprima');
var fs = require('fs');
var proxyquire = require('proxyquire');
var sinon = require('sinon');

var Comments = sinon.stub();

var helpers = {
  mergeObjects: sinon.stub()
};

var esprimaHelpers = {
  getPropertyValue: sinon.stub()
};

var routerParser = proxyquire('../../../lib/routerParser', {
  './models/Comments': Comments,
  './helpers/helpers': helpers,
  './helpers/esprimaHelpers': esprimaHelpers
});

describe('routerParser', function() {
  describe('getRoutesFromRouter', function() {
    beforeEach(function() {
      this.sb = sinon.sandbox.create();
      this.sb.stub(routerParser, 'parseRouter');
      this.sb.stub(fs, 'readFileSync');
      this.sb.stub(console, 'error');
    });

    afterEach(function() {
      this.sb.restore();
    });

    it('calls parseRouter with the result of reading the file in the given path', function() {
      fs.readFileSync.returns('some content');

      routerParser.getRoutesFromRouter('/some/path');

      assert.strictEqual(routerParser.parseRouter.args[0][0], 'some content');
    });

    it('returns result from parseRouter', function() {
      routerParser.parseRouter.returns('parsed');

      assert.strictEqual(routerParser.getRoutesFromRouter('/some/path'), 'parsed');
    });

    it('logs error if unable to open or parse file', function() {
      var exception = {error: 'something'};
      fs.readFileSync.throws(exception);

      routerParser.getRoutesFromRouter('hello');

      assert.strictEqual(console.error.args[0][0], exception);
    });
  });

  describe('parseRouter', function() {
    beforeEach(function() {
      this.sb = sinon.sandbox.create();
      this.sb.stub(routerParser, 'getRouterMapBody');
      this.sb.stub(routerParser, 'parseExpressionStatement');
    });

    afterEach(function() {
      this.sb.restore();
      Comments.reset();
    });

    it('returns null if getRouterMapBody returns null', function() {
      var parsed = routerParser.parseRouter('someRouterCode');

      assert.strictEqual(parsed, null);
    });

    it('calls parseExpressionStatement for all expressions', function() {
      var routerCode =
        'App.Router.map(function() {' +
          'this.route("hello");' +
          'this.resource("world");' +
        '});';
      var ast = esprima.parse(routerCode);
      routerParser.getRouterMapBody.returns(ast.body[0].expression.arguments[0].body);

      routerParser.parseRouter(routerCode);

      assert.strictEqual(routerParser.parseExpressionStatement.callCount, 2);
    });

    it('saves passed options', function() {
      var options = {some: 'option'};

      routerParser.parseRouter('someRouterCode', options);

      assert.strictEqual(routerParser.options, options);
    });

    it('creates an instance of Comments', function() {
      var routerCode =
        'App.Router.map(function() {' +
          '// hello\n' +
          'this.route("hello");' +
          'this.resource("world");' +
        '});';
      var ast = esprima.parse(routerCode, {comment: true, loc: true});

      routerParser.parseRouter(routerCode);

      assert.deepEqual(Comments.args[0][0], ast.comments);
    });
  });

  describe('parseExpressionStatement', function() {
    beforeEach(function() {
      this.sb = sinon.sandbox.create();
      this.sb.stub(routerParser, 'addRoute');
      this.sb.stub(routerParser, 'addResource');
    });

    afterEach(function() {
      this.sb.restore();
    });

    it('calls addRoute when the expression is called in a route', function() {
      var routes = {};
      var expression = {
        expression: {
          callee: {
            property: {
              name: 'route'
            }
          }
        }
      };

      routerParser.parseExpressionStatement(expression, routes);

      assert.deepEqual(routerParser.addRoute.args[0], [expression, routes]);
    });

    it('calls addResource when the expression is called in resource', function() {
      var routes = {};
      var expression = {
        expression: {
          callee: {
            property: {
              name: 'resource'
            }
          }
        }
      };

      routerParser.parseExpressionStatement(expression, routes);

      assert.deepEqual(routerParser.addResource.args[0], [expression, routes]);
    });
  });

  describe('addResource', function() {
    beforeEach(function() {
      this.sb = sinon.sandbox.create();
      this.sb.stub(routerParser, 'addRoute');
      this.sb.stub(routerParser, 'parseExpressionStatement');
      this.sb.stub(routerParser, 'buildPrefix');
    });

    afterEach(function() {
      this.sb.restore();
      helpers.mergeObjects.reset();
    });

    it('uses addRoute to parse resource with no callback', function() {
      var routerCode = 'this.resouce("hello");';
      var ast = esprima.parse(routerCode).body[0];
      var prefix = {};

      routerParser.addResource(ast, prefix);

      assert.strictEqual(routerParser.addRoute.args[0][0], ast);
      assert.strictEqual(routerParser.addRoute.args[0][1], prefix);
    });

    it('uses addRoute to parse resource with path and no callback', function() {
      var routerCode = 'this.resource("hello", {asdf: "qwer", path: "/some/path"});';
      var ast = esprima.parse(routerCode).body[0];
      var prefix = {};

      routerParser.addResource(ast, prefix);

      assert.strictEqual(routerParser.addRoute.args[0][0], ast);
      assert.strictEqual(routerParser.addRoute.args[0][1], prefix);
    });

    it('returns result of addRoute if resource with no callback', function() {
      var routerCode = 'this.resouce("hello");';
      var ast = esprima.parse(routerCode).body[0];
      routerParser.addRoute.returns('someRoutes');

      var routes = routerParser.addResource(ast);

      assert.strictEqual(routes, 'someRoutes');
    });

    it('doesn\'t call addRoute if there is a callback as the last argument', function() {
      var routerCode = 'this.resource("hello", {hello: "world"}, function() {});';
      var ast = esprima.parse(routerCode).body[0];

      routerParser.addResource(ast);

      assert.ok(!routerParser.addRoute.called);
    });

    it('parses resource with routes correctly', function() {
      var routerCode = 'this.resource("hello", function() {' +
        'this.route("new");' +
        'this.route("edit");' +
      '});';
      var ast = esprima.parse(routerCode).body[0];

      routerParser.addResource(ast);

      var args = routerParser.parseExpressionStatement.args;
      assert.strictEqual(args[0][0].expression.arguments[0].value, 'new');
      assert.strictEqual(args[1][0].expression.arguments[0].value, 'edit');
    });

    it('parses resource with path and routes correctly', function() {
      var routerCode = 'this.resource("hello", {path: "/some/thing"}, function() {' +
        'this.route("new");' +
        'this.route("edit");' +
      '});';
      var ast = esprima.parse(routerCode).body[0];

      routerParser.addResource(ast);

      var args = routerParser.parseExpressionStatement.args;
      assert.strictEqual(args[0][0].expression.arguments[0].value, 'new');
      assert.strictEqual(args[1][0].expression.arguments[0].value, 'edit');
    });

    it('builds prefix before calling parseExpressionStatement', function() {
      var routerCode = 'this.resource("hello", function() {' +
        'this.route("edit");' +
      '});';
      var ast = esprima.parse(routerCode).body[0];
      routerParser.buildPrefix.returns('builtPrefix');

      routerParser.addResource(ast, 'prefix');

      assert.strictEqual(routerParser.buildPrefix.args[0][0], ast);
      assert.strictEqual(routerParser.buildPrefix.args[0][1], 'prefix');
      assert.strictEqual(
        routerParser.parseExpressionStatement.args[0][1],
        'builtPrefix'
      );
    });

    it('merges routes with parseExpressionStatement result', function() {
      var routerCode = 'this.resource("hello", function() {' +
        'this.route("edit");' +
      '});';
      var ast = esprima.parse(routerCode).body[0];
      routerParser.addRoute.returns('parsedRoute');
      routerParser.parseExpressionStatement.returns('parsedExpression');

      var routes = routerParser.addResource(ast, 'prefixExpression');

      assert.strictEqual(helpers.mergeObjects.args[0][0], routes);
      assert.strictEqual(helpers.mergeObjects.args[0][1], 'parsedRoute');
      assert.strictEqual(helpers.mergeObjects.args[1][0], routes);
      assert.strictEqual(helpers.mergeObjects.args[1][1], 'parsedExpression');
    });
  });

  describe('addRoute', function() {
    beforeEach(function() {
      routerParser.options = {
        onlyAnnotated: false
      };
      routerParser.comments = {
        shouldDocumentRoute: sinon.stub(),
        getExpressionComment: sinon.stub().returns({})
      };
    });

    afterEach(function() {
      esprimaHelpers.getPropertyValue.reset();
      helpers.mergeObjects.reset();
    });

    it('parses route', function() {
      var routerCode = 'this.route("hello");';
      var ast = esprima.parse(routerCode).body[0];

      var routes = routerParser.addRoute(ast);

      var expected = {
        hello: {
          path: '/hello'
        }
      };
      assert.deepEqual(routes, expected);
    });

    it('parses route with path', function() {
      var routerCode = 'this.route("hello", {asdf: "qwer", path: "/some/path"});';
      var ast = esprima.parse(routerCode).body[0];
      var args = ast.expression.arguments;
      esprimaHelpers.getPropertyValue.withArgs(args[1], 'path').returns('/some/path');

      var routes = routerParser.addRoute(ast);

      var expected = {
        hello: {
          path: '/some/path'
        }
      };
      assert.deepEqual(routes, expected);
    });

    it('uses prefixes when building route', function() {
      var routerCode = 'this.route("hello");';
      var ast = esprima.parse(routerCode).body[0];
      var prefix = {
        name: 'tacos',
        path: '/ta/quito'
      };

      var routes = routerParser.addRoute(ast, prefix);

      var expected = {
        tacosHello: {
          path: '/ta/quito/hello'
        }
      };
      assert.deepEqual(routes, expected);
    });

    it('parses resource with callback as route', function() {
      var routerCode = 'this.resource("hello", function() {});';
      var ast = esprima.parse(routerCode).body[0];

      var routes = routerParser.addRoute(ast);

      var expected = {
        hello: {
          path: '/hello'
        }
      };
      assert.deepEqual(routes, expected);
    });

    it('parses rosource with path and callback as route', function() {
      var routerCode = 'this.resource("hello", {path: "/a"}, function() {});';
      var ast = esprima.parse(routerCode).body[0];
      var args = ast.expression.arguments;
      esprimaHelpers.getPropertyValue.withArgs(args[1], 'path').returns('/a');

      var routes = routerParser.addRoute(ast);

      var expected = {
        hello: {
          path: '/a'
        }
      };
      assert.deepEqual(routes, expected);
    });

    it('doesn\'t add route if shouldDocumentRoute returns false', function() {
      routerParser.options.onlyAnnotated = true;
      var routerCode = 'this.resource("hello", {path: "/a"}, function() {});';
      var ast = esprima.parse(routerCode).body[0];

      var routes = routerParser.addRoute(ast);

      assert.deepEqual(routes, {});
    });

    it('adds route if shouldDocumentRoute returns true', function() {
      routerParser.options.onlyAnnotated = true;
      routerParser.comments.shouldDocumentRoute.returns(true);
      var routerCode = 'this.resource("hello", {path: "/a"}, function() {});';
      var ast = esprima.parse(routerCode).body[0];

      var routes = routerParser.addRoute(ast);

      var expected = {
        hello: {
          path: '/a'
        }
      };
      assert.deepEqual(routes, expected);
    });

    it('doesn\'nt add comment attributes if there is no comment', function() {
      var routerCode = 'this.resource("hello", {path: "/a"}, function() {});';
      var ast = esprima.parse(routerCode).body[0];

      var routes = routerParser.addRoute(ast);

      assert.strictEqual(routes.doc, undefined);
    });

    it('adds comment information if there is a comment', function() {
      var comments = {
        main: 'Hello',
        params: {
          hello: 'world'
        }
      };
      routerParser.comments.getExpressionComment.returns(comments);
      var routerCode = 'this.resource("hello", {path: "/a"}, function() {});';
      var ast = esprima.parse(routerCode).body[0];

      var routes = routerParser.addRoute(ast);

      assert.strictEqual(routes.hello.doc, 'Hello');
      assert.strictEqual(routes.hello.params, comments.params);
    });

    it('adds comment information if there is a comment and prefix', function() {
      var prefix = {
        name: 'hola',
        params: {
          perro: 'gato'
        }
      };
      var comments = {
        main: 'Hello',
        params: {
          hello: 'world'
        }
      };
      routerParser.comments.getExpressionComment.returns(comments);
      var routerCode = 'this.resource("hello", {path: "/a"}, function() {});';
      var ast = esprima.parse(routerCode).body[0];

      var routes = routerParser.addRoute(ast, prefix);

      assert.strictEqual(routes.holaHello.doc, 'Hello');
      assert.strictEqual(routes.holaHello.params.perro, 'gato');
      assert.strictEqual(helpers.mergeObjects.args[0][0], prefix.params);
      assert.strictEqual(helpers.mergeObjects.args[0][1], comments.params);
    });
  });

  describe('getRouterMapBody', function() {
    it('returns undefined if map is not found', function() {
      var routerCode =
        'var Router = Ember.Router.extend({' +
          'location: FooENV.locationType' +
        '});';
      var ast = esprima.parse(routerCode);

      var map = routerParser.getRouterMapBody(ast);

      assert.strictEqual(map, undefined);
    });

    it('returns map body if found', function() {
      var routerCode =
        'var Router = Ember.Router.extend({' +
          'location: FooENV.locationType' +
        '});' +
        'Router.map(function() {});';
      var ast = esprima.parse(routerCode);

      var map = routerParser.getRouterMapBody(ast);

      assert.strictEqual(map.type, 'BlockStatement');
    });
  });

  describe('buildPrefix', function() {
    beforeEach(function() {
      routerParser.comments = {
        getExpressionComment: sinon.stub().returns({})
      };
    });

    afterEach(function() {
      delete routerParser.comments;
      esprimaHelpers.getPropertyValue.reset();
      helpers.mergeObjects.reset();
    });

    it('uses value if there is no previous prefix and path', function() {
      var routerCode = 'this.route("hello");';
      var ast = esprima.parse(routerCode).body[0];

      var newPrefix = routerParser.buildPrefix(ast);

      assert.strictEqual(newPrefix.name, 'hello');
      assert.strictEqual(newPrefix.path, '/hello');
    });

    it('uses path if there was one specified', function() {
      var routerCode = 'this.route("hello", {path: "/a/b"});';
      var ast = esprima.parse(routerCode).body[0];
      esprimaHelpers.getPropertyValue.returns('/a/b');

      var newPrefix = routerParser.buildPrefix(ast);

      assert.strictEqual(newPrefix.name, 'hello');
      assert.strictEqual(newPrefix.path, '/a/b');
    });

    it('uses path if there is a path and a callback', function() {
      var routerCode = 'this.resource("hello", {path: "/a/b"}, function() {' +
        'this.route("asdf");' +
      '});';
      var ast = esprima.parse(routerCode).body[0];
      esprimaHelpers.getPropertyValue.returns('/a/b');

      var newPrefix = routerParser.buildPrefix(ast);

      assert.strictEqual(newPrefix.name, 'hello');
      assert.strictEqual(newPrefix.path, '/a/b');
    });

    it('extends previous prefix values if they exist', function() {
      var routerCode = 'this.route("hello");';
      var ast = esprima.parse(routerCode).body[0];
      var prefix = {
        name: 'jose',
        path: '/sanchez'
      };

      var newPrefix = routerParser.buildPrefix(ast, prefix);

      assert.strictEqual(newPrefix.name, 'joseHello');
      assert.strictEqual(newPrefix.path, '/sanchez/hello');
    });

    it('adds expression params when there are no params in prefix', function() {
      var routerCode = 'this.route("hello");';
      var ast = esprima.parse(routerCode).body[0];
      routerParser.comments.getExpressionComment.returns({params: 'params'});

      var newPrefix = routerParser.buildPrefix(ast, {});

      assert.strictEqual(newPrefix.params, 'params');
    });

    it('merges expression params and prefix params when there are params in prefix', function() {
      var routerCode = 'this.route("hello");';
      var ast = esprima.parse(routerCode).body[0];
      var prefix = {
        name: 'tacos',
        path: '/tacos',
        params: {
          taquitos: 'Con frijolito'
        }
      };
      var comments = {
        params: {
          cerveza: 'Por favor'
        }
      };
      routerParser.comments.getExpressionComment.returns(comments);

      var newPrefix = routerParser.buildPrefix(ast, prefix);

      assert.strictEqual(newPrefix.params, prefix.params);
      assert.strictEqual(helpers.mergeObjects.args[0][0], prefix.params);
      assert.strictEqual(helpers.mergeObjects.args[0][1], comments.params);
    });
  });
});
