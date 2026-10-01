// @title Basic button
import { CwButton } from '../../src/index.js';

export default {
  async render() {
    await new Promise((resolve) => setImmediate(resolve));
    return CwButton.render({
      props: { variant: 'solid' },
      slots: { default: () => 'Save changes' },
    });
  },
};
