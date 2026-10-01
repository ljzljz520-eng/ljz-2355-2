// @title Button without accessible name (a11y failure fixture)
import { CwButton } from '../../src/index.js';

export default {
  render() {
    // Empty content, no aria-label: must fail the a11y gate.
    return CwButton.render({
      props: { variant: 'ghost' },
      slots: { default: () => '   ' },
    });
  },
};
