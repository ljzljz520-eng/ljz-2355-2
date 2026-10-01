// @title Recursive tree data
import { CwTree } from '../../src/index.js';

export default {
  render() {
    return CwTree.render({
      props: {
        data: [
          { value: 'root', label: 'Root',
            children: [ { value: 'child', label: 'Child', children: [{ value: 'leaf', label: 'Leaf' }] } ] },
        ],
      },
      slots: { node: ({ node }) => `<span>${node.label}</span>` },
    });
  },
};
