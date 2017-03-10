export default function walk(expr, fn) {
  // pre-fix dfs walk
  let stack=[expr.root]
  // ATTENTION: to get the correct order of children
  // we must push children in reverse order, as we are using
  // a stack
  while(stack.length) {
    const next = stack.pop()
    // visit before descending
    fn(next)
    switch(next.type) {
      case 'definition':
        stack.push(next.expr)
        break
      case 'function':
      case 'call':
        for (let i = next.args.length - 1; i >= 0; i--) {
          stack.push(next.args[i])
        }
        break
      case 'plus':
      case 'minus':
      case 'mult':
      case 'div':
      case 'power':
        stack.push(next.right)
        stack.push(next.left)
        break
      case 'array':
        for (let i = next.vals.length - 1; i >= 0; i--) {
          stack.push(next.vals[i])
        }
        break
      case 'object':
        for (let i = next.entries.length - 1; i >= 0; i--) {
          stack.push(next.entries[i].val)
        }
        break
      default:
        //
    }
  }
}