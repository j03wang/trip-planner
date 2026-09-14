export function createFocusSyncState(initialRevision = 0) {
    return {
        knownRevision: initialRevision,
        nextLocalVersion: 1,
        pending: [],
        deferred: undefined,
    };
}

export function queueLocalFocus(state, focus) {
    const request = { version: state.nextLocalVersion, focus: { ...focus } };
    state.nextLocalVersion += 1;
    state.pending.push(request);
    return request;
}

export function receiveAuthoritativeFocus(state, update) {
    if (!Number.isSafeInteger(update?.focusRevision) || update.focusRevision < state.knownRevision) {
        return { apply: false };
    }
    state.knownRevision = update.focusRevision;
    if (state.pending.length) {
        if (!state.deferred || update.focusRevision >= state.deferred.focusRevision) {
            state.deferred = { ...update, focus: { ...(update.focus ?? {}) } };
        }
        return { apply: false };
    }
    return { apply: true, focus: update.focus ?? {} };
}

export function settleLocalFocus(state, version, update, { authoritative = false } = {}) {
    state.pending = state.pending.filter((request) => request.version !== version);
    if (Number.isSafeInteger(update?.focusRevision)) {
        state.knownRevision = Math.max(state.knownRevision, update.focusRevision);
    }
    if (state.pending.length) return { apply: false };
    const candidate = authoritative ? update : state.deferred;
    state.deferred = undefined;
    if (!candidate || candidate.focusRevision < state.knownRevision) return { apply: false };
    state.knownRevision = candidate.focusRevision;
    return { apply: true, focus: candidate.focus ?? {} };
}
