// @title Busy state (migration from loading)
import { CwButton } from '../../src/index.js';

export default {
  async render() {
    await new Promise((resolve) => setImmediate(resolve));
    return CwButton.render({
      props: { variant: 'solid', busy: { pending: true, progress: 40 } },
      slots: { default: () => 'Saving…' },
    });
  },
};
