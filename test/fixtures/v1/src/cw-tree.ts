import { defineComponent, defineProps } from './component.js';
import type { TreeProps, TreeEvents, TreeData } from './types.js';

/** cw-tree displays recursive hierarchical data. */
export const CwTree = defineComponent<TreeProps, TreeEvents>({
  name: 'cw-tree',
  description: 'Display recursive hierarchical data.',
  props: defineProps<TreeProps>({
    data: { type: Object as unknown as TreeData, required: true },
    guides: { type: Boolean, default: true },
    expanded: { type: Array, default: () => [] },
  }),
  emits: ['toggle'],
  render({ props, slots }) {
    const guide = slots.guide ? slots.guide() : '';
    const label = slots.node
      ? slots.node
      : undefined;
    void label;
    void guide;
    const renderNodes = (nodes: TreeData, depth: number): string =>
      nodes
        .map(
          (node) =>
            `<li role="treeitem" style="padding-left:${depth * 12}px">${
              slots.node ? slots.node({ node }) : node.label
            }${
              node.children?.length
                ? `<ul role="group">${renderNodes(node.children, depth + 1)}</ul>`
                : ''
            }</li>`,
        )
        .join('');
    return `${guide}<ul role="tree" class="cw-tree${
      props.guides ? ' cw-tree--guides' : ''
    }">${renderNodes(props.data, 0)}</ul>`;
  },
});
