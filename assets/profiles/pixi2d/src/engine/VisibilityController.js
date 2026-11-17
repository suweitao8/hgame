/** Suspend a starter while its host is hidden without resuming a manual pause. */
export function bindVisibilitySuspension(app, { resetInput = () => {}, onVisibility = () => {} } = {}) {
  let suspended = false;
  function visibilityChanged(visible) {
    if (!visible) {
      resetInput();
      if (app.running && !app.paused) suspended = app.pause();
    } else if (suspended) {
      suspended = false;
      if (app.running && app.paused) app.resume();
    }
    onVisibility(visible);
  }
  const lifecycle = app.platform.lifecycle;
  const offVisibility = lifecycle.on('visibility', visibilityChanged);
  const offFocus = lifecycle.on('focus', focused => { if (!focused) resetInput(); });
  return {
    sync() { visibilityChanged(lifecycle.visible); },
    dispose() { offVisibility(); offFocus(); suspended = false; },
  };
}
