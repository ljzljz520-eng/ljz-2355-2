import { defineComponent, defineProps } from './component.js';
import type { TreeProps, TreeEvents, TreeData } from './types.js';

/** cw-tree displays recursive hierarchical data. */
export const CwTree = defineComponent<TreeProps, TreeEvents>({
  name: 'cw-tree',
  description: 'Display recursive hierarchical data.',
  props: defineProps<TreeProps>({
    data: { type: Object as unknown as TreeData, required: true },
    initiallyExpanded: { type: Array, default: () => [] },
  }),
  emits: ['toggle'],
  render({ props, slots }) {
    const expandedSet = new Set(props.initiallyExpanded ?? []);
    const renderNodes = (nodes: TreeData, depth: number): string =>
      nodes
        .map(
          (node) =>
            `<li role="treeitem" aria-expanded="${expandedSet.has(node.value)}" style="padding-left:${depth * 12}px">${
              slots.node ? slots.node({ node }) : node.label
            }${
              node.children?.length
                ? `<ul role="group">${renderNodes(node.children, depth + 1)}</ul>`
                : ''
            }</li>`,
        )
        .join('');
    return `<ul role="tree" class="cw-tree">${renderNodes(props.data, 0)}</ul>`;
  },
});
