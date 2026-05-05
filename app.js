const USER_SESSION_KEY = 'user_session';

App({
  globalData: {
    userSession: null
  },

  onLaunch() {
    this.globalData.userSession = wx.getStorageSync(USER_SESSION_KEY) || null;
  },

  getUserSession() {
    if (this.globalData.userSession) {
      return this.globalData.userSession;
    }

    const storedSession = wx.getStorageSync(USER_SESSION_KEY) || null;
    this.globalData.userSession = storedSession;
    return storedSession;
  },

  setUserSession(session) {
    this.globalData.userSession = session || null;

    if (session) {
      wx.setStorageSync(USER_SESSION_KEY, session);
      return;
    }

    wx.removeStorageSync(USER_SESSION_KEY);
  },

  clearUserSession() {
    this.globalData.userSession = null;
    wx.removeStorageSync(USER_SESSION_KEY);
    wx.removeStorageSync('user_openid');
  }
})
