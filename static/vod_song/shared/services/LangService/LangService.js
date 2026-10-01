/**
 * 语言服务
 */
class LangService {
  constructor() {
    this.currentLanguage = 'zh_cn';
    try {
      const saved = localStorage.getItem('ktv:language');
      if (this.getSupportedLanguages().includes(saved)) this.currentLanguage = saved;
    } catch (_) { /* 浏览器禁用存储时仍可切换语言。 */ }
    this.translations = {};
    this.observers = [];
    this._initialized = false; // 标记是否已初始化
    this._initializing = false; // 标记是否正在初始化
  }

  /**
   * 设置当前语言
   * @param {string} language - 语言代码
   */
  setLanguage(language) {
    if (!this.getSupportedLanguages().includes(language)) return;
    this.currentLanguage = language;
    try { localStorage.setItem('ktv:language', language); } catch (_) {}
    this._updateBodyClass();
    import('../../utils/Logger.js').then(({ logInfo }) => {
    }).catch(() => { });
  }

  _updateBodyClass() {
    if (typeof document !== 'undefined' && document.body) {
      const lang = this.currentLanguage.split('_')[0];
      // 移除旧的所有语言类
      document.body.classList.remove('lang-zh', 'lang-id', 'lang-en', 'lang-vi');
      // 添加新的语言类
      document.body.classList.add(`lang-${lang}`);
    }
  }

  /**
   * 获取当前语言
   * @returns {string} 当前语言代码
   */
  getCurrentLanguage() {
    return this.currentLanguage;
  }

  /**
   * 加载语言文件
   * @param {string} language - 语言代码
   * @returns {Promise} 加载结果Promise
   */
  async loadLanguageFile(language) {
    try {
      // 定义语言文件映射
      const languageFileMap = {
        'zh_cn': 'cn_zh.json',
        'cn': 'cn_zh.json',
        'zh': 'cn_zh.json',
        'en_us': 'en_us.json',
        'en': 'en_us.json',
        'id_id': 'id_di.json',
        'id': 'id_di.json',
        'id_di': 'id_di.json',
        'vi_vn': 'vi_vn.json',
        'vi': 'vi_vn.json',
        'vn': 'vi_vn.json'
      };

      const fileName = languageFileMap[language] || 'cn_zh.json';

      // 构建多种可能的路径尝试
      // Capacitor 环境使用相对路径
      const isCapacitor = typeof window !== 'undefined' && window.Capacitor !== undefined;
      const basePath = isCapacitor ? '../shared/services/LangService/' : '/vod_song/shared/services/LangService/';
      const url = `${basePath}${fileName}?v=${Date.now()}`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`无法加载语言文件: ${url}, 状态码: ${response.status}`);
      }

      const translations = await response.json();
      this.translations[language] = translations;

      // 调试日志：确认键是否存在
      if (translations['roomNotInUse']) {
      } else {
        console.warn(`[LangService] 成功加载 ${language}, 但缺少 roomNotInUse 键!`);
      }

      import('../../utils/Logger.js').then(({ logInfo }) => {
      }).catch(() => { });
      return { success: true };
    } catch (error) {
      import('../../utils/Logger.js').then(({ logError }) => {
        logError('LangService', `加载语言 ${language} 失败`, error);
      }).catch(() => { });

      // 如果加载失败，且不是默认中文，尝试使用中文
      if (language !== 'zh_cn') {
        return this.loadLanguageFile('zh_cn');
      }
      throw error;
    }
  }

  /**
   * 翻译文本
   * @param {string} key - 翻译键
   * @param {Object} params - 翻译参数
   * @returns {string} 翻译后的文本
   */
  translate(key, params = {}) {
    try {
      // 如果当前语言的翻译尚未加载，则尝试加载
      if (!this.translations[this.currentLanguage]) {
        import('../../utils/Logger.js').then(({ logWarn }) => {
        }).catch(() => { });
        // 注意：在实际使用中，这里可能需要异步处理
        // 但在translate方法中无法使用async/await，所以我们只记录警告
      }

      // 获取当前语言的翻译
      const currentTranslations = this.translations[this.currentLanguage];
      if (currentTranslations && currentTranslations[key]) {
        return currentTranslations[key];
      }

      // 如果当前语言没有找到翻译，尝试使用中文作为后备
      const defaultTranslations = this.translations['zh_cn'];
      if (defaultTranslations && defaultTranslations[key]) {
        return defaultTranslations[key];
      }

      // 如果都没有找到，返回键名
      return key;
    } catch (error) {
      import('../../utils/Logger.js').then(({ logWarn }) => {
      }).catch(() => { });
      return key;
    }
  }

  /**
   * 初始化语言服务
   * @returns {Promise} 初始化结果Promise
   */
  async init() {
    // 防止重复初始化
    if (this._initialized) {
      import('../../utils/Logger.js').then(({ logInfo }) => {
      }).catch(() => { });
      return { success: true };
    }

    // 防止并发初始化
    if (this._initializing) {
      // 等待正在进行的初始化完成
      const { default: TimerManager } = await import('../../utils/TimerManager.js');
      while (this._initializing) {
        await TimerManager.delay(50);
      }
      return { success: true };
    }

    this._initializing = true;

    try {
      // 首次进入恢复已保存语言，不覆盖用户上次选择。
      await this.loadLanguageFile(this.currentLanguage);
      this._updateBodyClass();
      this._initialized = true;
      // 使用统一的日志服务（如果可用）
      import('../../utils/Logger.js').then(({ logInfo }) => {
      }).catch(() => { });
      return { success: true };
    } catch (error) {
      import('../../utils/Logger.js').then(({ logError }) => {
        logError('LangService', '语言服务初始化失败', error);
      }).catch(() => { });
      return { success: false, error: error.message };
    } finally {
      this._initializing = false;
    }
  }

  /**
   * 添加观察者
   * @param {Function} callback - 回调函数
   */
  addObserver(callback) {
    if (typeof callback === 'function') {
      this.observers.push(callback);
      import('../../utils/Logger.js').then(({ logInfo }) => {
      }).catch(() => { });
    } else {
      import('../../utils/Logger.js').then(({ logError }) => {
        logError('LangService', '观察者必须是函数', new Error('观察者必须是函数'));
      }).catch(() => { });
    }
  }

  /**
   * 获取支持的语言列表
   * @returns {Array} 支持的语言列表
   */
  getSupportedLanguages() {
    return ['zh_cn', 'en_us', 'id_id', 'vi_vn'];
  }

  /**
   * 切换语言
   * @param {string} language - 语言代码
   * @returns {Promise} 切换结果Promise
   */
  async switchLanguage(language) {
    try {
      // 加载新语言的翻译文件
      await this.loadLanguageFile(language);

      // 更新当前语言
      this.setLanguage(language);
      import('../../utils/Logger.js').then(({ logInfo }) => {
      }).catch(() => { });

      // 通知所有观察者
      this.observers.forEach(observer => {
        try {
          observer(language);
        } catch (error) {
          import('../../utils/Logger.js').then(({ logError }) => {
            logError('LangService', '语言观察者通知失败', error);
          }).catch(() => { });
        }
      });

      return { success: true };
    } catch (error) {
      import('../../utils/Logger.js').then(({ logError }) => {
        logError('LangService', '切换语言失败', error);
      }).catch(() => { });
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取翻译文本
   * @param {string} key - 翻译键
   * @returns {string} 翻译后的文本
   */
  t(key) {
    return this.translate(key);
  }
}

// 创建并导出语言服务实例
const langService = new LangService();
export default langService;