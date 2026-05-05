const { API_BASE_URL } = require('../../utils/config');

const FALLBACK_MODELS = [
  {
    key: 'yolo11s_from_previous_v3_best',
    name: 'YOLO11s V3',
    folder: 'yolo11s_from_previous_v3_best',
    description: '默认推荐模型，综合精度与稳定性更适合日常检测。'
  },
  {
    key: 'yolo5n_test',
    name: 'YOLO5n',
    folder: 'yolo5n_test',
    description: '更轻量，适合更关注推理速度的场景。'
  },
  {
    key: 'yolo8n_test',
    name: 'YOLO8n',
    folder: 'yolo8n_test',
    description: '轻量新版备选模型，可用于效果对比。'
  }
];

Page({
  data: {
    API_BASE_URL,
    modelOptions: FALLBACK_MODELS,
    currentModelKey: 'yolo11s_from_previous_v3_best',
    currentModelName: 'YOLO11s V3',
    currentModelFolder: 'yolo11s_from_previous_v3_best',
    updatedAt: '',
    statusText: '正在同步当前模型...',
    isLoading: true,
    isSaving: false,
    pendingModelKey: ''
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: '模型切换' });
    this.loadModelConfig();
  },

  normalizeModelOptions(models) {
    if (!Array.isArray(models) || models.length === 0) {
      return FALLBACK_MODELS;
    }

    return models.map((model) => ({
      key: model.key,
      name: model.name,
      folder: model.folder,
      description: model.description
    }));
  },

  applyModelConfig(payload) {
    const currentModel = payload.current_model || {};
    const modelOptions = this.normalizeModelOptions(payload.models);

    this.setData({
      modelOptions,
      currentModelKey: payload.current_model_key || currentModel.key || this.data.currentModelKey,
      currentModelName: currentModel.name || this.data.currentModelName,
      currentModelFolder: currentModel.folder || this.data.currentModelFolder,
      updatedAt: payload.updated_at || '',
      statusText: payload.updated_at
        ? `当前模型已同步，最后更新于 ${payload.updated_at}`
        : '当前模型已同步',
      isLoading: false
    });
  },

  loadModelConfig() {
    this.setData({
      isLoading: true,
      statusText: '正在同步当前模型...'
    });

    wx.request({
      url: `${API_BASE_URL}/model-config`,
      method: 'GET',
      success: (res) => {
        if (res.data?.success) {
          this.applyModelConfig(res.data);
          return;
        }

        this.setData({
          isLoading: false,
          statusText: `获取模型配置失败，当前显示本地默认配置。接口：${API_BASE_URL}`
        });
        wx.showToast({ title: '获取模型失败', icon: 'none' });
      },
      fail: () => {
        this.setData({
          isLoading: false,
          statusText: `无法连接后端，当前显示本地默认配置。接口：${API_BASE_URL}`
        });
        wx.showToast({ title: '网络错误', icon: 'none' });
      }
    });
  },

  selectModel(e) {
    const modelKey = e.currentTarget.dataset.key;
    const selectedModel = this.data.modelOptions.find((item) => item.key === modelKey);

    if (!selectedModel || this.data.isSaving || modelKey === this.data.currentModelKey) {
      return;
    }

    this.setData({
      isSaving: true,
      pendingModelKey: modelKey,
      statusText: `正在切换到 ${selectedModel.name}...`
    });

    wx.request({
      url: `${API_BASE_URL}/model-config`,
      method: 'POST',
      data: { model_key: modelKey },
      success: (res) => {
        if (res.data?.success) {
          this.applyModelConfig(res.data);
          wx.showToast({ title: '切换成功', icon: 'success' });
          return;
        }

        this.setData({
          statusText: res.data?.msg || `模型切换失败。接口：${API_BASE_URL}`
        });
        wx.showToast({ title: res.data?.msg || '切换失败', icon: 'none' });
      },
      fail: () => {
        this.setData({
          statusText: `模型切换失败，请检查后端服务。接口：${API_BASE_URL}`
        });
        wx.showToast({ title: '网络错误', icon: 'none' });
      },
      complete: () => {
        this.setData({
          isSaving: false,
          pendingModelKey: ''
        });
      }
    });
  }
});
