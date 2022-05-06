module.exports = {
  skipFiles: ["flat", "libraries", "mocks", "interfaces", "utils"],
  mocha: {
    fgrep: "[skip-on-coverage]",
    invert: true,
  },
};
