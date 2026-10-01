// @title Basic button
import { CwButton } from '../../src/index.js';

export default {
  render() {
    return CwButton.render({
      props: { variant: 'solid' },
      slots: { default: () => 'Save changes' },
    });
  },
};
