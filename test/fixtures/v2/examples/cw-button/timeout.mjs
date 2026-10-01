// @title Never-resolving async example (timeout fixture)
export default {
  render() {
    // Intentionally never resolves; runner must kill it after the timeout.
    return new Promise(() => {});
  },
};
