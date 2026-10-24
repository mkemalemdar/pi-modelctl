// "Remove everything": once the extension's files are deleted, nothing may write files again in this pi process
// (modelctl.json, pi's settings), or the cleanup would leave new leftovers. The flag lives on
// globalThis so it also holds if pi loads the extension again (/new, /reload).

const state = globalThis as typeof globalThis & { __piModelctlRemoved?: boolean };

export function markRemoved(): void {
	state.__piModelctlRemoved = true;
}

/** True after "Remove everything" ran in this process: the extension stays inert. */
export function isRemoved(): boolean {
	return state.__piModelctlRemoved === true;
}
