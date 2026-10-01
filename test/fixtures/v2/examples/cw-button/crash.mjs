// @title Example that kills its worker (worker-crash fixture)
//
// process.exit() terminates only this worker thread's execution context with
// a non-zero code — unlike process.kill(process.pid) it cannot take down the
// main ingest process. The orchestrator must classify this as kind=crash and
// keep processing every other example.
process.exit(99);

export default { render() { return ''; } };
