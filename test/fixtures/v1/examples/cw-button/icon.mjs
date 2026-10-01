// @title Icon-only button with aria-label
import { CwButton } from '../../src/index.js';

export default {
  render() {
    return CwButton.render({
      props: { variant: 'ghost', ariaLabel: 'Search' },
      slots: { icon: () => '<span aria-hidden="true">🔍</span>' },
    });
  },
};
