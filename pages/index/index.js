const { API_BASE_URL } = require('../../utils/config');
const HISTORY_BATCHES_STORAGE_KEY = 'history_batches';
const HISTORY_GROUP_GAP_MS = 60 * 1000;

Page({
  data: {
    originalImages: [],
    resultImages: [],
    resultImageTempPaths: [],
    detectionCounts: [],
    detectionDetailsList: [],
    uploadStatus: [],
    currentIndex: 0,
    totalImageCount: 0,
    totalAppleCount: 0,
    detectionDetails: [],
    showSaveButton: false,
    connectionStatus: '连接中...',
    operationStatus: '欢迎使用',
    API_BASE_URL,
    showHistory: false,
    historyList: [],
    historyGroups: [],
    selectedHistoryGroup: null,
    showHistoryGroupDetail: false,
    historyListHeight: 0,
    showScrollHint: false,
    currentUser: null,
    showAuthModal: false,
    authMode: 'login',
    loginForm: {
      account: '',
      password: ''
    },
    registerForm: {
      username: '',
      account: '',
      password: '',
      confirmPassword: ''
    },
    authLoading: false,
    authStatusText: '请输入账号和密码'
  },

  calculateTotalAppleCount(detectionCounts) {
    const counts = detectionCounts || this.data.detectionCounts;
    return counts.reduce((total, count) => total + (Number(count) || 0), 0);
  },

  generateBatchId() {
    return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  },

  parseHistoryDate(dateString) {
    if (!dateString) return 0;
    const normalized = `${dateString}`.replace(/-/g, '/').replace('T', ' ');
    const timestamp = new Date(normalized).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  },

  formatHistoryDate(dateInput) {
    const timestamp = dateInput instanceof Date ? dateInput.getTime() : this.parseHistoryDate(dateInput);
    const date = dateInput instanceof Date ? dateInput : new Date(timestamp || Date.now());
    if (Number.isNaN(date.getTime())) {
      return typeof dateInput === 'string' ? dateInput : '';
    }
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  },

  normalizeImageUrl(url) {
    if (typeof url !== 'string') return '';
    return url.trim().replace(/^https?:\/\/[^/]+/i, '').replace(/\?.*$/, '');
  },

  getHistoryBatchStorageKey() {
    const session = this.getCurrentSession();
    const suffix = session?.userId ? `_${session.userId}` : '_guest';
    return `${HISTORY_BATCHES_STORAGE_KEY}${suffix}`;
  },

  getStoredHistoryBatches() {
    const batches = wx.getStorageSync(this.getHistoryBatchStorageKey());
    return Array.isArray(batches) ? batches : [];
  },

  saveStoredHistoryBatches(batches) {
    wx.setStorageSync(this.getHistoryBatchStorageKey(), batches.slice(0, 100));
  },

  initializeCurrentUploadBatch(totalCount) {
    const createdAt = new Date();
    this.currentUploadBatch = {
      batchId: this.generateBatchId(),
      createdAt: createdAt.toISOString(),
      displayDate: this.formatHistoryDate(createdAt),
      totalImageCount: totalCount,
      items: new Array(totalCount).fill(null)
    };
  },

  recordUploadBatchItem(index, item) {
    if (!this.currentUploadBatch) return;
    this.currentUploadBatch.items[index] = {
      index,
      resultImage: this.normalizeImageUrl(item.resultImage),
      originalImage: this.normalizeImageUrl(item.originalImage),
      detectionCount: Number(item.detectionCount) || 0,
      date: item.date || this.currentUploadBatch.displayDate
    };
  },

  persistCurrentUploadBatch() {
    if (!this.currentUploadBatch) return;

    const validItems = (this.currentUploadBatch.items || []).filter(Boolean);
    if (validItems.length === 0) {
      this.currentUploadBatch = null;
      return;
    }

    const storedBatches = this.getStoredHistoryBatches().filter(
      (batch) => batch.batchId !== this.currentUploadBatch.batchId
    );

    storedBatches.unshift({
      batchId: this.currentUploadBatch.batchId,
      createdAt: this.currentUploadBatch.createdAt,
      displayDate: this.currentUploadBatch.displayDate,
      totalImageCount: this.currentUploadBatch.totalImageCount,
      totalAppleCount: validItems.reduce((total, batchItem) => total + (Number(batchItem.detectionCount) || 0), 0),
      items: validItems
    });

    this.saveStoredHistoryBatches(storedBatches);
    this.currentUploadBatch = null;
  },

  buildHistoryBatchLookup() {
    const batchIdByImageUrl = {};
    const batchMetaById = {};

    this.getStoredHistoryBatches().forEach((batch) => {
      batchMetaById[batch.batchId] = batch;
      (batch.items || []).forEach((item) => {
        const resultKey = this.normalizeImageUrl(item.resultImage);
        const originalKey = this.normalizeImageUrl(item.originalImage);
        if (resultKey) batchIdByImageUrl[resultKey] = batch.batchId;
        if (originalKey) batchIdByImageUrl[originalKey] = batch.batchId;
      });
    });

    return {
      batchIdByImageUrl,
      batchMetaById
    };
  },

  formatHistoryGroup(group, batchMeta) {
    const orderMap = {};
    (batchMeta?.items || []).forEach((item, index) => {
      const resultKey = this.normalizeImageUrl(item.resultImage);
      if (resultKey) {
        orderMap[resultKey] = typeof item.index === 'number' ? item.index : index;
      }
    });

    const records = [...group.records]
      .sort((a, b) => {
        const orderA = orderMap[this.normalizeImageUrl(a.result_image)];
        const orderB = orderMap[this.normalizeImageUrl(b.result_image)];

        if (typeof orderA === 'number' && typeof orderB === 'number' && orderA !== orderB) {
          return orderA - orderB;
        }
        if (typeof orderA === 'number') return -1;
        if (typeof orderB === 'number') return 1;

        const timeDiff = this.parseHistoryDate(a.date) - this.parseHistoryDate(b.date);
        if (timeDiff !== 0) return timeDiff;

        return (Number(a.id) || 0) - (Number(b.id) || 0);
      })
      .map((record, index) => ({
        ...record,
        imageLabel: `第 ${index + 1} 张`
      }));

    const latestRecord = [...records].sort(
      (a, b) => this.parseHistoryDate(b.date) - this.parseHistoryDate(a.date)
    )[0] || {};

    return {
      id: group.id,
      batchId: group.batchId,
      date: batchMeta?.displayDate || latestRecord.date || group.date,
      imageCount: records.length,
      totalAppleCount: records.reduce((total, record) => total + (Number(record.detection_count) || 0), 0),
      records
    };
  },

  groupHistoryRecords(history) {
    const records = Array.isArray(history) ? [...history] : [];
    if (records.length === 0) return [];

    const { batchIdByImageUrl, batchMetaById } = this.buildHistoryBatchLookup();

    records.sort((a, b) => {
      const timeDiff = this.parseHistoryDate(b.date) - this.parseHistoryDate(a.date);
      if (timeDiff !== 0) return timeDiff;
      return (Number(b.id) || 0) - (Number(a.id) || 0);
    });

    const groups = [];
    const groupMap = {};
    let fallbackGroup = null;

    records.forEach((record, index) => {
      const matchedBatchId =
        record.batch_id ||
        batchIdByImageUrl[this.normalizeImageUrl(record.result_image)] ||
        batchIdByImageUrl[this.normalizeImageUrl(record.original_image)];

      if (matchedBatchId) {
        let group = groupMap[matchedBatchId];
        if (!group) {
          const batchMeta = batchMetaById[matchedBatchId];
          group = {
            id: matchedBatchId,
            batchId: matchedBatchId,
            date: batchMeta?.displayDate || record.date,
            records: [],
            latestTimestamp: this.parseHistoryDate(batchMeta?.displayDate || record.date)
          };
          groupMap[matchedBatchId] = group;
          groups.push(group);
        }

        group.records.push(record);
        group.latestTimestamp = Math.max(group.latestTimestamp || 0, this.parseHistoryDate(record.date));
        fallbackGroup = null;
        return;
      }

      const recordTimestamp = this.parseHistoryDate(record.date);
      const shouldCreateNewFallbackGroup =
        !fallbackGroup ||
        !fallbackGroup.latestTimestamp ||
        !recordTimestamp ||
        Math.abs(fallbackGroup.latestTimestamp - recordTimestamp) > HISTORY_GROUP_GAP_MS;

      if (shouldCreateNewFallbackGroup) {
        fallbackGroup = {
          id: `history_group_${record.id || index}`,
          batchId: '',
          date: record.date,
          records: [],
          latestTimestamp: recordTimestamp
        };
        groups.push(fallbackGroup);
      }

      fallbackGroup.records.push(record);
      if (recordTimestamp) {
        fallbackGroup.latestTimestamp = recordTimestamp;
      }
    });

    return groups
      .map((group) => this.formatHistoryGroup(group, batchMetaById[group.batchId]))
      .sort((a, b) => this.parseHistoryDate(b.date) - this.parseHistoryDate(a.date));
  },

  normalizeHistoryGroups(historyGroups) {
    if (!Array.isArray(historyGroups)) return [];

    return historyGroups.map((group) => {
      const records = Array.isArray(group.records) ? group.records : [];

      return {
        id: group.id || group.batch_id || `history_group_${this.parseHistoryDate(group.date)}`,
        batchId: group.batch_id || '',
        date: group.date || '',
        imageCount: Number(group.image_count) || records.length,
        totalAppleCount: Number(group.total_apple_count) || 0,
        records: records.map((record, index) => ({
          ...record,
          imageLabel: record.image_label || `第 ${index + 1} 张`
        }))
      };
    });
  },

  getSelectedHistoryRecord(recordIndex) {
    return this.data.selectedHistoryGroup?.records?.[recordIndex] || null;
  },

  previewHistoryImage(imageUrl, emptyText) {
    if (imageUrl) {
      wx.previewImage({ urls: [imageUrl], current: imageUrl });
    } else {
      wx.showToast({ title: emptyText, icon: 'none' });
    }
  },

  getAppInstance() {
    return getApp();
  },

  getCurrentSession() {
    return this.getAppInstance().getUserSession();
  },

  setCurrentSession(session) {
    this.getAppInstance().setUserSession(session);
    this.setData({
      currentUser: session,
      showAuthModal: !session,
      authStatusText: session ? `当前用户：${session.username}` : '请输入账号和密码'
    });
  },

  ensureLoggedIn() {
    const session = this.getCurrentSession();
    if (session) {
      return session;
    }

    this.setData({
      showAuthModal: true,
      authMode: 'login',
      authStatusText: '请先登录后再使用'
    });
    wx.showToast({ title: '请先登录', icon: 'none' });
    return null;
  },

  fillSessionFromStorage() {
    const session = this.getCurrentSession();
    this.setData({
      currentUser: session,
      showAuthModal: !session,
      authStatusText: session ? `当前用户：${session.username}` : '请输入账号和密码'
    });
  },

  switchAuthMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode || mode === this.data.authMode || this.data.authLoading) return;

    this.setData({
      authMode: mode,
      authStatusText: mode === 'login' ? '请输入账号和密码' : '请填写注册信息'
    });
  },

  onLoginInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [`loginForm.${field}`]: e.detail.value
    });
  },

  onRegisterInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [`registerForm.${field}`]: e.detail.value
    });
  },

  submitLogin() {
    const { account, password } = this.data.loginForm;
    if (!account || !password) {
      wx.showToast({ title: '请输入账号和密码', icon: 'none' });
      return;
    }

    this.setData({
      authLoading: true,
      authStatusText: '登录中...'
    });

    wx.request({
      url: `${API_BASE_URL}/login`,
      method: 'POST',
      data: { account, password },
      success: (res) => {
        if (res.data?.success) {
          this.setCurrentSession(res.data.user);
          this.setData({
            loginForm: { account: '', password: '' },
            operationStatus: '欢迎使用'
          });
          wx.showToast({ title: '登录成功', icon: 'success' });
          return;
        }

        this.setData({
          authStatusText: res.data?.msg || '登录失败'
        });
        wx.showToast({ title: res.data?.msg || '登录失败', icon: 'none' });
      },
      fail: () => {
        this.setData({
          authStatusText: '网络错误，请稍后重试'
        });
        wx.showToast({ title: '网络错误', icon: 'none' });
      },
      complete: () => {
        this.setData({ authLoading: false });
      }
    });
  },

  submitRegister() {
    const { username, account, password, confirmPassword } = this.data.registerForm;
    if (!username || !account || !password || !confirmPassword) {
      wx.showToast({ title: '请填写完整信息', icon: 'none' });
      return;
    }
    if (password !== confirmPassword) {
      wx.showToast({ title: '两次密码不一致', icon: 'none' });
      return;
    }

    this.setData({
      authLoading: true,
      authStatusText: '注册中...'
    });

    wx.request({
      url: `${API_BASE_URL}/register`,
      method: 'POST',
      data: { username, account, password },
      success: (res) => {
        if (res.data?.success) {
          this.setCurrentSession(res.data.user);
          this.setData({
            registerForm: { username: '', account: '', password: '', confirmPassword: '' },
            authMode: 'login',
            operationStatus: '欢迎使用'
          });
          wx.showToast({ title: '注册成功', icon: 'success' });
          return;
        }

        this.setData({
          authStatusText: res.data?.msg || '注册失败'
        });
        wx.showToast({ title: res.data?.msg || '注册失败', icon: 'none' });
      },
      fail: () => {
        this.setData({
          authStatusText: '网络错误，请稍后重试'
        });
        wx.showToast({ title: '网络错误', icon: 'none' });
      },
      complete: () => {
        this.setData({ authLoading: false });
      }
    });
  },

  loginWithTempOpenid() {
    if (this.data.authLoading) return;

    this.setData({
      authLoading: true,
      authStatusText: '正在使用 openid 临时登录...'
    });

    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          this.useRandomUserFallback();
          return;
        }

        wx.request({
          url: `${API_BASE_URL}/get-openid`,
          method: 'POST',
          data: { code: loginRes.code },
          success: (res) => {
            if (res.data?.success && res.data.openid) {
              this.loginWithOpenid(res.data.openid);
              return;
            }
            this.useRandomUserFallback();
          },
          fail: () => {
            this.useRandomUserFallback();
          }
        });
      },
      fail: () => {
        this.useRandomUserFallback();
      }
    });
  },

  useRandomUserFallback() {
    const openid = `temp_openid_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    this.loginWithOpenid(openid);
  },

  loginWithOpenid(openid) {
    wx.request({
      url: `${API_BASE_URL}/temp-openid-login`,
      method: 'POST',
      data: { openid },
      success: (res) => {
        if (res.data?.success) {
          wx.setStorageSync('user_openid', openid);
          this.setCurrentSession(res.data.user);
          this.setData({
            operationStatus: '欢迎使用'
          });
          wx.showToast({ title: '登录成功', icon: 'success' });
          return;
        }

        this.setData({
          authStatusText: res.data?.msg || '临时登录失败'
        });
        wx.showToast({ title: res.data?.msg || '临时登录失败', icon: 'none' });
      },
      fail: () => {
        this.setData({
          authStatusText: '网络错误，请稍后重试'
        });
        wx.showToast({ title: '网络错误', icon: 'none' });
      },
      complete: () => {
        this.setData({ authLoading: false });
      }
    });
  },

  uploadImage() {
    const session = this.ensureLoggedIn();
    if (!session) return;

    wx.chooseImage({
      count: 9,
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePaths = res.tempFilePaths;
        const count = tempFilePaths.length;
        this.initializeCurrentUploadBatch(count);
        this.setData({
          originalImages: tempFilePaths,
          resultImages: new Array(count).fill(''),
          resultImageTempPaths: new Array(count).fill(''),
          detectionCounts: new Array(count).fill(0),
          detectionDetailsList: new Array(count).fill([]),
          uploadStatus: new Array(count).fill('waiting'),
          currentIndex: 0,
          totalImageCount: count,
          totalAppleCount: 0,
          showSaveButton: false,
          operationStatus: `已选择 ${count} 张图片，开始上传...`
        });
        this.uploadCurrentImage();
      },
      fail: () => {
        this.currentUploadBatch = null;
        this.setData({ operationStatus: '已取消选择图片' });
      }
    });
  },

  uploadCurrentImage() {
    const session = this.ensureLoggedIn();
    const index = this.data.currentIndex;
    if (!session || index < 0 || index >= this.data.originalImages.length) return;
    if (this.data.uploadStatus[index] !== 'waiting') return;

    const tempFilePath = this.data.originalImages[index];
    const uploadStatus = [...this.data.uploadStatus];
    uploadStatus[index] = 'uploading';
    this.setData({
      uploadStatus,
      operationStatus: `正在上传第 ${index + 1}/${this.data.originalImages.length} 张...`
    });

    wx.showLoading({ title: '上传中...', mask: true });

    wx.uploadFile({
      url: `${API_BASE_URL}/upload`,
      filePath: tempFilePath,
      name: 'file',
      formData: {
        user_id: session.userId,
        username: session.username,
        account: session.account,
        login_type: session.loginType || 'account',
        openid: session.openid || '',
        batch_id: this.currentUploadBatch?.batchId || this.generateBatchId(),
        batch_total: this.currentUploadBatch?.totalImageCount || this.data.originalImages.length,
        batch_index: index + 1
      },
      success: (uploadRes) => {
        wx.hideLoading();
        try {
          const data = JSON.parse(uploadRes.data);
          if (!data.success) {
            throw new Error(data.error || data.msg || '上传失败');
          }

          const resultImages = [...this.data.resultImages];
          const detectionCounts = [...this.data.detectionCounts];
          const detectionDetailsList = [...this.data.detectionDetailsList];

          resultImages[index] = '';
          detectionCounts[index] = data.detection_count || 0;
          detectionDetailsList[index] = data.detections || [];

          this.setData({
            resultImages,
            detectionCounts,
            detectionDetailsList,
            totalAppleCount: this.calculateTotalAppleCount(detectionCounts),
            operationStatus: `第 ${index + 1} 张上传成功，检测到 ${detectionCounts[index]} 个苹果`
          });

          this.recordUploadBatchItem(index, {
            resultImage: data.result_url,
            originalImage: tempFilePath,
            detectionCount: detectionCounts[index],
            date: data.date || this.currentUploadBatch?.displayDate
          });

          if (data.result_url) {
            this.downloadResultImage(data.result_url, index);
            return;
          }

          const nextStatus = [...this.data.uploadStatus];
          nextStatus[index] = 'success';
          this.setData({ uploadStatus: nextStatus });
          this.uploadNext();
        } catch (error) {
          const nextStatus = [...this.data.uploadStatus];
          nextStatus[index] = 'fail';
          this.setData({
            uploadStatus: nextStatus,
            operationStatus: `第 ${index + 1} 张上传失败`
          });
          this.uploadNext();
        }
      },
      fail: () => {
        wx.hideLoading();
        const nextStatus = [...this.data.uploadStatus];
        nextStatus[index] = 'fail';
        this.setData({
          uploadStatus: nextStatus,
          operationStatus: `第 ${index + 1} 张网络错误`
        });
        this.uploadNext();
      }
    });
  },

  downloadResultImage(imageUrl, index) {
    wx.downloadFile({
      url: imageUrl,
      sslVerify: false,
      success: (downloadRes) => {
        const resultImages = [...this.data.resultImages];
        const resultTempPaths = [...this.data.resultImageTempPaths];
        const uploadStatus = [...this.data.uploadStatus];
        resultImages[index] = downloadRes.tempFilePath;
        resultTempPaths[index] = downloadRes.tempFilePath;
        uploadStatus[index] = 'success';

        this.setData({
          resultImages,
          resultImageTempPaths: resultTempPaths,
          uploadStatus
        });

        this.uploadNext();
      },
      fail: () => {
        const uploadStatus = [...this.data.uploadStatus];
        uploadStatus[index] = 'success';
        this.setData({ uploadStatus });
        this.uploadNext();
      }
    });
  },

  uploadNext() {
    const nextIndex = this.data.currentIndex + 1;
    if (nextIndex < this.data.originalImages.length) {
      this.setData({ currentIndex: nextIndex }, () => {
        this.uploadCurrentImage();
      });
    } else {
      this.persistCurrentUploadBatch();
      this.setData({
        operationStatus: '全部图片处理完成',
        showSaveButton: true
      });
      wx.showToast({ title: '全部完成', icon: 'success' });
    }
  },

  onSwiperChange(e) {
    const index = e.detail.current;
    this.setData({ currentIndex: index });
    if (this.data.uploadStatus[index] === 'waiting') {
      this.uploadCurrentImage();
    }
  },

  viewHistory() {
    const session = this.ensureLoggedIn();
    if (!session) return;

    wx.showLoading({ title: '加载历史记录中...', mask: true });
    wx.request({
      url: `${API_BASE_URL}/history`,
      method: 'GET',
      data: { user_id: session.userId },
      success: (res) => {
        wx.hideLoading();
        if (!res.data?.success) {
          wx.showToast({ title: '获取历史记录失败', icon: 'none' });
          return;
        }

        const history = res.data.history || [];
        const historyGroups = Array.isArray(res.data.history_groups) &&
          (res.data.history_groups.length > 0 || history.length === 0)
          ? this.normalizeHistoryGroups(res.data.history_groups)
          : this.groupHistoryRecords(history);

        this.setData({
          historyList: history,
          historyGroups,
          selectedHistoryGroup: null,
          showHistoryGroupDetail: false,
          showHistory: true,
          showScrollHint: historyGroups.length > 2
        }, () => {
          setTimeout(() => this.calculateHistoryListHeight(), 100);
        });

        if (history.length === 0) {
          wx.showToast({ title: '暂无历史记录', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '网络错误', icon: 'none' });
      }
    });
  },

  openHistoryGroup(e) {
    const index = e.currentTarget.dataset.index;
    const selectedHistoryGroup = this.data.historyGroups[index];
    if (!selectedHistoryGroup) return;

    this.setData({
      selectedHistoryGroup,
      showHistoryGroupDetail: true,
      showScrollHint: (selectedHistoryGroup.records || []).length > 2
    });
  },

  backToHistoryGroups() {
    this.setData({
      selectedHistoryGroup: null,
      showHistoryGroupDetail: false,
      showScrollHint: this.data.historyGroups.length > 2
    });
  },

  message() {
    if (!this.ensureLoggedIn()) return;
    wx.navigateTo({ url: '/pages/message/message' });
  },

  model() {
    if (!this.ensureLoggedIn()) return;
    wx.navigateTo({ url: '/pages/currentmodel/currentmodel' });
  },

  calculateHistoryListHeight() {
    wx.getSystemInfo({
      success: (res) => {
        const windowHeight = res.windowHeight;
        const rpxToPx = res.windowWidth / 750;
        const headerHeight = 120 * rpxToPx;
        const footerHeight = 100 * rpxToPx;
        const availableHeight = windowHeight - headerHeight - footerHeight - 40;
        this.setData({ historyListHeight: Math.max(availableHeight, 300) });
      },
      fail: () => this.setData({ historyListHeight: 400 })
    });
  },

  viewGroupOriginalImage(e) {
    const recordIndex = e.currentTarget.dataset.recordIndex;
    const record = this.getSelectedHistoryRecord(recordIndex);
    this.previewHistoryImage(record?.original_image, '原图不存在');
  },

  viewGroupResultImage(e) {
    const recordIndex = e.currentTarget.dataset.recordIndex;
    const record = this.getSelectedHistoryRecord(recordIndex);
    this.previewHistoryImage(record?.result_image, '结果图不存在');
  },

  viewGroupDetails(e) {
    const recordIndex = e.currentTarget.dataset.recordIndex;
    const record = this.getSelectedHistoryRecord(recordIndex);
    this.showRecordDetails(record);
  },

  hideHistory() {
    this.setData({
      showHistory: false,
      historyList: [],
      historyGroups: [],
      selectedHistoryGroup: null,
      showHistoryGroupDetail: false,
      historyListHeight: 0,
      showScrollHint: false
    });
  },

  clearHistory() {
    const session = this.ensureLoggedIn();
    if (!session) return;

    wx.showModal({
      title: '确认清空',
      content: '确定要清空所有历史记录吗？此操作不可恢复。',
      success: (modalRes) => {
        if (!modalRes.confirm) return;

        wx.request({
          url: `${API_BASE_URL}/clear-history`,
          method: 'POST',
          data: { user_id: session.userId },
          success: (res) => {
            if (!res.data?.success) {
              wx.showToast({ title: '清空失败', icon: 'none' });
              return;
            }

            wx.showToast({ title: '已清空历史记录', icon: 'success' });
            this.saveStoredHistoryBatches([]);
            this.setData({
              historyList: [],
              historyGroups: [],
              selectedHistoryGroup: null,
              showHistoryGroupDetail: false,
              showHistory: false,
              historyListHeight: 0,
              showScrollHint: false
            });
          },
          fail: () => {
            wx.showToast({ title: '网络错误', icon: 'none' });
          }
        });
      }
    });
  },

  catchTouchMove() {
    return;
  },

  showRecordDetails(record) {
    if (!record) {
      wx.showToast({ title: '记录不存在', icon: 'none' });
      return;
    }

    let detailText = `检测时间：${record.date}\n检测结果：发现 ${record.detection_count} 个苹果\n\n`;
    if (record.detection_details?.length > 0) {
      detailText += '检测详情：\n';
      record.detection_details.forEach((detail, index) => {
        detailText += `${index + 1}. 置信度 ${(detail.confidence * 100).toFixed(1)}%，位置：[${detail.bbox.join(', ')}]\n`;
      });
    }

    wx.showModal({
      title: '检测记录详情',
      content: detailText,
      showCancel: false,
      confirmText: '确定'
    });
  },

  saveToAlbum() {
    const currentPath = this.data.resultImageTempPaths[this.data.currentIndex];
    if (!currentPath) {
      wx.showToast({ title: '当前图片暂无结果可保存', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中...', mask: true });
    wx.saveImageToPhotosAlbum({
      filePath: currentPath,
      success: () => {
        wx.hideLoading();
        wx.showToast({ title: '保存成功', icon: 'success' });
        this.setData({ operationStatus: '已保存到相册' });
      },
      fail: (err) => {
        wx.hideLoading();
        if (err.errMsg.includes('auth deny')) {
          wx.showModal({
            title: '保存失败',
            content: '需要授权保存图片到相册',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) {
                wx.openSetting();
              }
            }
          });
          return;
        }
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    });
  },

  clearImages() {
    this.currentUploadBatch = null;
    this.setData({
      originalImages: [],
      resultImages: [],
      resultImageTempPaths: [],
      detectionCounts: [],
      detectionDetailsList: [],
      uploadStatus: [],
      currentIndex: 0,
      totalImageCount: 0,
      totalAppleCount: 0,
      showSaveButton: false,
      operationStatus: '已清空'
    });
    wx.showToast({ title: '已清空', icon: 'success' });
  },

  testAPI() {
    wx.request({
      url: `${API_BASE_URL}/test`,
      method: 'GET',
      success: (res) => {
        const data = res.data || {};
        const operationStatus = data.inference_available === false
          ? '后端已连接，但推理未加载'
          : this.data.operationStatus === '欢迎使用'
            ? '欢迎使用'
            : this.data.operationStatus;

        this.setData({
          connectionStatus: '已连接',
          operationStatus
        });
      },
      fail: () => this.setData({ connectionStatus: '连接失败' })
    });
  },

  onLoad() {
    this.fillSessionFromStorage();
    this.testAPI();
    setTimeout(() => {
      if (this.data.connectionStatus === '连接中...') {
        this.setData({ connectionStatus: '连接失败' });
      }
    }, 3000);
  },

  onShow() {
    this.fillSessionFromStorage();
    this.testAPI();
  },

  onPullDownRefresh() {
    this.fillSessionFromStorage();
    this.testAPI();
    wx.stopPullDownRefresh();
  },

  onShareAppMessage() {
    return {
      title: '苹果检测助手',
      path: '/pages/index/index',
      imageUrl: this.data.resultImages[this.data.currentIndex] || '/images/share-default.jpg'
    };
  }
});
