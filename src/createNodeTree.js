import {isString, isNumber} from 'substance'
import {
  Definition,
  NumberNode, StringNode, ArrayNode, ObjectNode, BooleanNode, Var,
  FunctionCall, NamedArgument,
  PipeOp,
  ErrorNode,
  EmptyArgument
} from './Nodes'

/**
* Maps the ANTLR4 AST to a our custom tree model.
*/
export default function createNodeTree (ast) {
  let state = {
    // generating ids by counting created nodes
    nodeId: 0,
    nodes: [],
    // extra list to all variables, cells, ranges
    // to be able to compute dependencies
    inputs: [],
    // tokens for code highlighting
    tokens: []
  }
  let root = createFromAST(state, ast)
  return { root, state }
}

function createFromAST (state, ast) {
  let node
  let [start, end] = _getStartStop(ast)
  switch (ast.type) {
    case 'evaluation':
      return createFromAST(state, ast.children[0])
    case 'definition': {
      let lhs = ast.children[0]
      state.tokens.push(new Token('output-name', lhs.symbol))
      node = new Definition(state.nodeId++, start, end, lhs.getText(), createFromAST(state, ast.children[2]))
      break
    }
    case 'simple':
      return createFromAST(state, ast.children[0])
    // Member selection operator `.`
    case 'select_id': {
      const value = createFromAST(state, ast.children[0])
      // Create a new string node from the member ID
      const id = new StringNode(state.nodeId++, start, end, ast.children[2].getText())
      state.nodes.push(id)
      node = new FunctionCall(state.nodeId++, start, end, 'select', [value, id])
      break
    }
    // Member selection operator `[]`
    case 'select_expr': {
      const args = exprSequence(state, [ast.children[0], ast.children[2]])
      node = new FunctionCall(state.nodeId++, start, end, 'select', args)
      break
    }
    // Unary operators
    case 'not':
    case 'positive':
    case 'negative': {
      const name = ast.type
      const args = exprSequence(state, [ast.children[1]])
      node = new FunctionCall(state.nodeId++, start, end, name, args)
      break
    }
    // Binary operators (in order of precedence)
    case 'pow':
    case 'multiply':
    case 'divide':
    case 'remainder':
    case 'add':
    case 'subtract':
    case 'less':
    case 'less_or_equal':
    case 'greater':
    case 'greater_or_equal':
    case 'equal':
    case 'not_equal':
    case 'and':
    case 'or': {
      const name = ast.type
      const args = exprSequence(state, [ast.children[0], ast.children[2]])
      node = new FunctionCall(state.nodeId++, start, end, name, args)
      break
    }
    // Pipe operator
    case 'pipe': {
      node = new PipeOp(state.nodeId++, start, end,
        createFromAST(state, ast.children[0]),
        createFromAST(state, ast.children[2])
      )
      break
    }
    case 'int':
    case 'float':
    case 'number': {
      if (ast.children.length !== 1) {
        node = new ErrorNode(state.nodeId++, start, end, 'Invalid number.')
      } else {
        let token = ast.children[0].children[0]
        state.tokens.push(new Token('number-literal', token.symbol))
        node = new NumberNode(state.nodeId++, start, end, Number(token.getText()))
      }
      break
    }
    case 'boolean': {
      let token = ast.children[0]
      state.tokens.push(new Token('boolean-literal', token.symbol))
      let bool = (token.getText() === 'true')
      node = new BooleanNode(state.nodeId++, start, end, bool)
      break
    }
    case 'string': {
      let ctx = ast.children[0]
      state.tokens.push(new Token('string-literal', ctx.symbol))
      let str = ctx.getText().slice(1, -1)
      node = new StringNode(state.nodeId++, start, end, str)
      break
    }
    case 'array': {
      const ctx = ast.children[0]
      const seq = ctx.children[1]
      let vals = []
      if (seq && seq.items) {
        vals = exprSequence(state, seq.items)
      }
      node = new ArrayNode(state.nodeId++, start, end, vals)
      break
    }
    case 'object': {
      const ctx = ast.children[0]
      const keys = ctx.keys
      const vals = ctx.vals
      const entries = []
      for (let i = 0; i < keys.length; i++) {
        state.tokens.push(new Token('key', keys[i]))
        if (keys[i] && vals[i]) {
          let key = keys[i].text
          let val = createFromAST(state, vals[i])
          entries.push({ key, val })
        }
      }
      node = new ObjectNode(state.nodeId++, start, end, entries)
      break
    }
    case 'var': {
      node = new Var(state.nodeId++, start, end, ast.getText())
      state.tokens.push(new Token('input-variable-name', {
        start: ast.start.start,
        stop: ast.stop.stop
      }))
      state.inputs.push(node)
      break
    }
    case 'group': {
      // No need to create an extra node for a group expression '(..)'
      return createFromAST(state, ast.children[1])
    }
    case '_call':
      // HACK: sometimes we need to unwrap
      ast = ast.children[0] // eslint-disable-line no-fallthrough
    case 'call': {
      // ATTENTION we need to be robust regarding partial expressions
      let name = ast.name ? ast.name.text : ''
      let args, namedArgs
      let argsCtx = ast.args
      if (argsCtx) {
        args = argSequence(state, argsCtx.args)
        namedArgs = argSequence(state, argsCtx.namedArgs)
      }
      if (ast.name) {
        state.tokens.push(
          new Token('function-name', ast.name)
        )
      }
      node = new FunctionCall(state.nodeId++, start, end, name, args, namedArgs)
      break
    }
    case 'named-argument': {
      let name = ast.children[0]
      state.tokens.push(new Token('key', name.symbol))
      node = new NamedArgument(state.nodeId++, start, end, name.toString(),
        createFromAST(state, ast.children[2])
      )
      break
    }
    default: {
      if (ast.exception) {
        // console.log('Creating ErrorNode with exception', ast)
        node = new ErrorNode(state.nodeId++, start, end, ast.exception)
      } else {
        // console.log('Creating ErrorNode', ast)
        node = new ErrorNode(state.nodeId++, start, end, 'Parser error.')
      }
    }
  }
  state.nodes.push(node)
  return node
}

class Token {
  constructor (type, symbol) {
    /* istanbul ignore next */
    const start = symbol.start
    const stop = symbol.stop
    if (!isString(type)) {
      throw new Error('Illegal argument: "type" must be a string')
    }
    /* istanbul ignore next */
    if (!isNumber(start)) {
      throw new Error('Illegal argument: "start" must be a number')
    }
    /* istanbul ignore next */
    if (!isNumber(stop)) {
      throw new Error('Illegal argument: "stop" must be a number')
    }
    this.type = type
    this.start = start
    // ATTENTION: seems that symbol.end is inclusive
    this.end = stop + 1
    this.text = symbol.text
  }
}

function exprSequence (state, items) {
  if (!items) return []
  return items.map(c => createFromAST(state, c))
}

function argSequence (state, args) {
  if (!args) return []
  // HACK: we need to allow empty arguments to support incomplete expressions such as in `sum(x,,y)`
  // Still we want to treat it as an error
  let result = []
  args = args.children
  let last
  for (let i = 0; i < args.length; i++) {
    let n = args[i]
    if (n.getText() === ',') {
      if (!last) {
        let [start, end] = _getStartStop(n)
        result.push(new EmptyArgument(state.nodeId++, start, end))
      }
      last = false
    } else {
      result.push(createFromAST(state, n))
      last = n
    }
  }
  if (!last) {
    last = args[args.length - 1]
    if (last.getText() === ',') {
      let [start, end] = _getStartStop(last)
      result.push(new EmptyArgument(state.nodeId++, start, end))
    }
  }
  return result
}

function _getStartStop (n) {
  if (n.start) {
    if (n.stop) {
      return [n.start.start, n.stop.stop + 1]
    } else {
      return [n.start.start, n.start.stop + 1]
    }
  } else if (n.symbol) {
    return [n.symbol.start, n.symbol.stop + 1]
  } else {
    return [undefined, undefined]
  }
}
