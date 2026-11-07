import '@testing-library/jest-dom/vitest';

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function (options?: ScrollToOptions | number, y?: number) {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {};
}
