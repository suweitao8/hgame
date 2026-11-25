const BILIBILI_MINIMUM_SDK = { share: [3, 8], rewardedVideo: [4, 0] };

function bilibiliSdkSupported(api, capability) {
  const minimum = BILIBILI_MINIMUM_SDK[capability];
  if (!minimum) return true;
  const version = /^(\d+)\.(\d+)(?:\.|$)/.exec(api.getSystemInfoSync?.()?.SDKVersion);
  if (!version) return false;
  const major = Number(version[1]);
  return major > minimum[0] || (major === minimum[0] && Number(version[2]) >= minimum[1]);
}

function sdkError(value, method) {
  if (value instanceof Error) return value;
  const error = new Error(value?.errMsg || value?.message || (typeof value === 'string' ? value : method + ' failed'));
  const code = value?.errNo ?? value?.errCode ?? value?.errno ?? value?.code;
  if (code !== undefined) error.code = code;
  return error;
}

function callWithCallbacks(api, method, options) {
  return new Promise((resolve, reject) => {
    api[method]({
      ...options,
      success: resolve,
      fail: error => reject(sdkError(error, method)),
    });
  });
}

function showAd(ad) {
  return new Promise((resolve, reject) => {
    let finished = false;
    function settle(callback, result) {
      if (finished) return;
      finished = true;
      ad.offClose(onClose);
      ad.offError(onError);
      callback(result);
    }
    const onClose = result => settle(resolve, { completed: result?.isEnded === true });
    const onError = error => settle(reject, sdkError(error, 'showRewardedVideo'));
    try {
      ad.onClose(onClose);
      ad.onError(onError);
    } catch (error) {
      onError(error);
      return;
    }
    Promise.resolve().then(async () => {
      if (!finished) await ad.load?.();
      if (!finished) await ad.show();
    }).catch(onError);
  });
}

export function createMinigameSdk(api, target) {
  const shareMethod = target === 'taptap' ? 'showShareboard' : 'shareAppMessage';
  const capabilities = {
    login: 'login',
    checkSession: 'checkSession',
    getLaunchOptions: 'getLaunchOptionsSync',
    share: shareMethod,
    rewardedVideo: 'createRewardedVideoAd',
    ...(target === 'bilibili' ? { launchSuccess: 'launchSuccess' } : {}),
  };
  let ad;
  let adUnit;
  let playing = false;
  let launchReported = false;

  function supports(capability) {
    return Object.prototype.hasOwnProperty.call(capabilities, capability) &&
      typeof api[capabilities[capability]] === 'function' &&
      (target !== 'bilibili' || bilibiliSdkSupported(api, capability));
  }

  function requireCapability(capability) {
    if (!supports(capability)) throw new Error(target + ' SDK capability is unavailable: ' + capability);
  }

  return Object.freeze({
    native: api,
    supports,
    async login({ timeout } = {}) {
      requireCapability('login');
      const options = target === 'douyin' ? { force: true } : timeout === undefined ? {} : { timeout };
      const result = await callWithCallbacks(api, 'login', options);
      if (typeof result?.code !== 'string' || !result.code.trim()) {
        throw new Error(target + ' login did not return an account code');
      }
      return { code: result.code };
    },
    async checkSession() {
      requireCapability('checkSession');
      return new Promise(resolve => api.checkSession({ success: () => resolve(true), fail: () => resolve(false) }));
    },
    getLaunchOptions() {
      requireCapability('getLaunchOptions');
      return api.getLaunchOptionsSync();
    },
    launchSuccess() {
      requireCapability('launchSuccess');
      if (launchReported) return false;
      api.launchSuccess();
      launchReported = true;
      return true;
    },
    async share({ title, imageUrl, query, channel, templateId, sceneParam } = {}) {
      requireCapability('share');
      if (target === 'taptap') {
        if (typeof templateId !== 'string' || !templateId.trim()) throw new Error('TapTap share requires a templateId');
        await callWithCallbacks(api, shareMethod, { templateId, sceneParam });
        return { status: 'opened' };
      }
      if (target === 'wechat') {
        api.shareAppMessage({ title, imageUrl, query });
        return { status: 'requested' };
      }
      if (target === 'bilibili') {
        await callWithCallbacks(api, shareMethod, { title, imageUrl, query });
        return { status: 'shared' };
      }
      return new Promise((resolve, reject) => api.shareAppMessage({
        title,
        query,
        channel,
        templateId,
        success: () => resolve({ status: 'shared' }),
        cancel: () => resolve({ status: 'cancelled' }),
        fail: value => {
          const error = sdkError(value, shareMethod);
          if (Number(error.code) === 10502) resolve({ status: 'cancelled' });
          else reject(error);
        },
      }));
    },
    async showRewardedVideo(adUnitId) {
      requireCapability('rewardedVideo');
      if (typeof adUnitId !== 'string' || !adUnitId.trim()) throw new Error('A rewarded video adUnitId is required');
      if (playing) throw new Error('A rewarded video is already in progress');
      playing = true;
      try {
        if (adUnit !== adUnitId) {
          if (ad && typeof ad.destroy !== 'function') throw new Error(target + ' cannot switch rewarded video ad units');
          ad?.destroy();
          ad = undefined;
          adUnit = undefined;
          const next = api.createRewardedVideoAd({ adUnitId });
          const methods = ['show', 'onClose', 'offClose', 'onError', 'offError'];
          if (!methods.every(method => typeof next?.[method] === 'function')) {
            next?.destroy?.();
            throw new Error(target + ' returned an incomplete rewarded video SDK');
          }
          ad = next;
          adUnit = adUnitId;
        }
        if (target === 'bilibili') api.reportScene?.({ sceneId: 1007 });
        return await showAd(ad);
      } finally {
        playing = false;
      }
    },
  });
}
