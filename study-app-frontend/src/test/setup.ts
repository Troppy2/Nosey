// Browser APIs jsdom leaves out. Defined once here so components do not need
// test-only guards; a test can still override any of them with vi.stubGlobal.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

if (!Element.prototype.animate) {
  Element.prototype.animate = function animate() {
    return { cancel() {}, finish() {} } as unknown as Animation;
  };
}

if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}
