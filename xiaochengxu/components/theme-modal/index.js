// components/theme-modal/index.js
// 全主题样式弹窗，替代微信原生 wx.showModal
// 用法：
//   wxml: <theme-modal id="modal" />
//   js:   onLoad/attached 后存 this.modal = this.selectComponent('#modal')
//         this.modal.show({ title, content, confirmText, cancelText, showCancel })
//             .then(confirmed => { ... })
Component({
  data: {
    visible: false,
    show: false, // 入场动画 class
    title: '',
    content: '',
    confirmText: '确定',
    cancelText: '取消',
    showCancel: true,
    type: 'info' // info / warning / danger
  },

  _resolve: null,

  methods: {
    show(opts = {}) {
      return new Promise((resolve) => {
        this._resolve = resolve;
        this.setData({
          visible: true,
          show: false,
          title: opts.title || '提示',
          content: opts.content || '',
          confirmText: opts.confirmText || '确定',
          cancelText: opts.cancelText || '取消',
          showCancel: opts.showCancel !== false,
          type: opts.type || 'info'
        });
        // 下一帧触发入场动画
        wx.nextTick(() => {
          this.setData({ show: true });
        });
      });
    },

    onCancel() {
      this._close(false);
    },

    onConfirm() {
      this._close(true);
    },

    onMaskTap() {
      // 点击蒙层关闭（仅当显示取消按钮时）
      if (this.data.showCancel) {
        this._close(false);
      }
    },

    preventClose() {
      // 防止冒泡触发蒙层关闭
    },

    _close(confirmed) {
      this.setData({ show: false });
      const resolve = this._resolve;
      this._resolve = null;
      // 等动画结束再 destroy
      setTimeout(() => {
        this.setData({ visible: false });
        if (resolve) resolve(confirmed);
      }, 200);
    }
  }
});
