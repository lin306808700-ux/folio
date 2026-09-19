// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

module.exports = new Proxy({}, { get: () => () => null })
