const { API_BASE_URL } = require('../../utils/config');

Page({
  data: {
    currentUser: null,
    showFeedbackModal: false,
    feedbackEmail: '',
    feedbackSuggestion: '',
    showProfileModal: false,
    profileForm: {
      username: '',
      password: '',
      confirmPassword: ''
    },
    savingProfile: false
  },

  getAppInstance() {
    return getApp();
  },

  loadCurrentUser() {
    const currentUser = this.getAppInstance().getUserSession();
    this.setData({ currentUser });

    if (!currentUser) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 500);
    }
  },

  showUserAgreement() {
    wx.showModal({
      title: '用户协议',
      content: `欢迎使用本小程序（以下简称“本应用”）。本协议是您与本应用之间关于使用本服务的说明。在测试期间，请您仔细阅读以下内容：

1. 本应用提供苹果检测、历史记录查看等功能，主要用于课程作业演示。

2. 您上传的图片请确保不含违法、侵权或侵犯他人隐私的内容。

3. 检测结果仅供参考，不作为任何正式结论。

4. 本应用可能随着作业开发过程继续调整。`,
      showCancel: false,
      confirmText: '我知道了'
    });
  },

  showPrivacyPolicy() {
    wx.showModal({
      title: '隐私政策',
      content: `本应用会保存您注册时填写的用户名、账号、密码，以及您上传后的检测历史记录，仅用于本次课程作业演示。

如果您使用“微信临时openid登录”，系统会保存对应的临时账号信息以区分不同用户。

您可以在本页修改用户名和密码，也可以清空自己的历史记录。`,
      showCancel: false,
      confirmText: '确定'
    });
  },

  showContactUs() {
    wx.showModal({
      title: '联系我们',
      content: '官方邮箱：2017924318@qq.com',
      showCancel: false,
      confirmText: '关闭'
    });
  },

  showFeedback() {
    this.setData({
      showFeedbackModal: true,
      feedbackEmail: '',
      feedbackSuggestion: ''
    });
  },

  hideFeedbackModal() {
    this.setData({ showFeedbackModal: false });
  },

  onEmailInput(e) {
    this.setData({ feedbackEmail: e.detail.value });
  },

  onSuggestionInput(e) {
    this.setData({ feedbackSuggestion: e.detail.value });
  },

  submitFeedback() {
    wx.showToast({
      title: '已提交',
      icon: 'success',
      duration: 1500
    });
    this.hideFeedbackModal();
  },

  openProfileModal() {
    const { currentUser } = this.data;
    if (!currentUser) return;

    this.setData({
      showProfileModal: true,
      profileForm: {
        username: currentUser.username || '',
        password: '',
        confirmPassword: ''
      }
    });
  },

  hideProfileModal() {
    this.setData({
      showProfileModal: false,
      profileForm: {
        username: this.data.currentUser?.username || '',
        password: '',
        confirmPassword: ''
      }
    });
  },

  onProfileInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [`profileForm.${field}`]: e.detail.value
    });
  },

  submitProfileUpdate() {
    const { currentUser, profileForm, savingProfile } = this.data;
    if (!currentUser || savingProfile) return;

    if (!profileForm.username) {
      wx.showToast({ title: '用户名不能为空', icon: 'none' });
      return;
    }

    if (profileForm.password && profileForm.password !== profileForm.confirmPassword) {
      wx.showToast({ title: '两次密码不一致', icon: 'none' });
      return;
    }

    this.setData({ savingProfile: true });

    wx.request({
      url: `${API_BASE_URL}/update-user`,
      method: 'POST',
      data: {
        user_id: currentUser.userId,
        username: profileForm.username,
        password: profileForm.password
      },
      success: (res) => {
        if (!res.data?.success) {
          wx.showToast({ title: res.data?.msg || '修改失败', icon: 'none' });
          return;
        }

        const updatedUser = res.data.user;
        this.getAppInstance().setUserSession(updatedUser);
        this.setData({
          currentUser: updatedUser,
          showProfileModal: false,
          profileForm: {
            username: updatedUser.username || '',
            password: '',
            confirmPassword: ''
          }
        });
        wx.showToast({ title: '修改成功', icon: 'success' });
      },
      fail: () => {
        wx.showToast({ title: '网络错误', icon: 'none' });
      },
      complete: () => {
        this.setData({ savingProfile: false });
      }
    });
  },

  logout() {
    this.getAppInstance().clearUserSession();
    wx.showToast({ title: '已退出登录', icon: 'success' });
    setTimeout(() => {
      wx.navigateBack({ delta: 1 });
    }, 500);
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  onShow() {
    this.loadCurrentUser();
  }
});
