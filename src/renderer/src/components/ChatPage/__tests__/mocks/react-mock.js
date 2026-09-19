// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

module.exports = {
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useRef: (init) => ({ current: init }),
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  createElement: () => null,
  createContext: () => ({ Provider: () => null }),
  useContext: () => ({}),
  memo: (c) => c,
}
module.exports.default = module.exports
