/**
 * 图片缓存服务 - 使用 IndexedDB 实现图片的永久缓存
 * 支持图片的存储、检索和自动清理
 */

class ImageCacheService {
  constructor() {
    this.dbName = 'huoshanKTV_image_cache';
    this.dbVersion = 1;
    this.storeName = 'images';
    this.db = null;
    this.maxCacheSize = 100 * 1024 * 1024; // 最大缓存大小：100MB
    this.maxAge = 30 * 24 * 60 * 60 * 1000; // 最大缓存时间：30天
    this.initPromise = null;
  }

  /**
   * 初始化 IndexedDB
   * @returns {Promise<IDBDatabase>}
   */
  async init() {
    if (this.db) {
      return this.db;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        import('../utils/Logger.js').then(({ logWarn }) => {
        }).catch(() => {});
        reject(new Error('IndexedDB not supported'));
        return;
      }

      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        import('../utils/Logger.js').then(({ logError }) => {
          logError('ImageCacheService', 'IndexedDB 打开失败', request.error);
        }).catch(() => {});
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        import('../utils/Logger.js').then(({ logInfo }) => {
        }).catch(() => {});
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // 创建对象存储
        if (!db.objectStoreNames.contains(this.storeName)) {
          const objectStore = db.createObjectStore(this.storeName, { keyPath: 'url' });
          // 创建索引：按时间戳排序，用于清理过期缓存
          objectStore.createIndex('timestamp', 'timestamp', { unique: false });
          // 创建索引：按大小排序，用于清理空间
          objectStore.createIndex('size', 'size', { unique: false });
          import('../utils/Logger.js').then(({ logInfo }) => {
          }).catch(() => {});
        }
      };
    });

    return this.initPromise;
  }

  /**
   * 将图片 URL 转换为缓存键
   * @param {string} url - 图片 URL
   * @returns {string} 缓存键
   */
  _getCacheKey(url) {
    return url;
  }

  /**
   * 获取缓存的图片
   * @param {string} url - 图片 URL
   * @returns {Promise<Blob|null>} 缓存的图片 Blob，如果不存在则返回 null
   */
  async get(url) {
    try {
      await this.init();
    } catch (e) {
      // IndexedDB 不支持，返回 null
      return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(this._getCacheKey(url));

      request.onsuccess = () => {
        const result = request.result;
        
        if (!result) {
          resolve(null);
          return;
        }

        // 检查是否过期
        const now = Date.now();
        if (result.timestamp && (now - result.timestamp) > this.maxAge) {
          // 已过期，删除并返回 null
          this.delete(url).catch(() => {});
          resolve(null);
          return;
        }

        // 返回缓存的图片 Blob
        resolve(result.blob);
      };

      request.onerror = () => {
        import('../utils/Logger.js').then(({ logError }) => {
          logError('ImageCacheService', '获取缓存失败', request.error);
        }).catch(() => {});
        resolve(null); // 失败时返回 null，不阻塞图片加载
      };
    });
  }

  /**
   * 存储图片到缓存
   * @param {string} url - 图片 URL
   * @param {Blob} blob - 图片 Blob
   * @returns {Promise<void>}
   */
  async set(url, blob) {
    try {
      await this.init();
    } catch (e) {
      // IndexedDB 不支持，跳过
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      const data = {
        url: this._getCacheKey(url),
        blob: blob,
        timestamp: Date.now(),
        size: blob.size
      };

      const request = store.put(data);

      request.onsuccess = () => {
        // 异步清理过期缓存和超出大小的缓存
        this._cleanup().catch(() => {});
        resolve();
      };

      request.onerror = () => {
        import('../utils/Logger.js').then(({ logError }) => {
          logError('ImageCacheService', '存储缓存失败', request.error);
        }).catch(() => {});
        resolve(); // 失败时不阻塞，继续执行
      };
    });
  }

  /**
   * 删除缓存的图片
   * @param {string} url - 图片 URL
   * @returns {Promise<void>}
   */
  async delete(url) {
    try {
      await this.init();
    } catch (e) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(this._getCacheKey(url));

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        import('../utils/Logger.js').then(({ logError }) => {
          logError('ImageCacheService', '删除缓存失败', request.error);
        }).catch(() => {});
        resolve(); // 失败时不阻塞
      };
    });
  }

  /**
   * 清理过期缓存和超出大小的缓存
   * 使用游标遍历元数据，避免将全部 blob 加载到内存
   * @returns {Promise<void>}
   */
  async _cleanup() {
    // 节流：距上次清理不足 60 秒则跳过
    const now = Date.now();
    if (this._lastCleanupTime && (now - this._lastCleanupTime < 60000)) {
      return;
    }
    this._lastCleanupTime = now;

    try {
      await this.init();
    } catch (e) {
      return;
    }

    return new Promise((resolve) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      let totalSize = 0;
      const expiredKeys = [];
      const metaList = [];

      // 使用游标遍历，只读取元数据（url/timestamp/size），不读取 blob
      const cursorRequest = store.openCursor();

      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const { url, timestamp, size } = cursor.value;
          const itemSize = size || 0;
          totalSize += itemSize;

          if (timestamp && (now - timestamp) > this.maxAge) {
            expiredKeys.push(url);
          } else {
            metaList.push({ url, timestamp: timestamp || 0, size: itemSize });
          }
          cursor.continue();
          return;
        }

        // 游标遍历完成——开始清理
        expiredKeys.forEach(url => store.delete(url));

        if (totalSize > this.maxCacheSize) {
          metaList.sort((a, b) => a.timestamp - b.timestamp);
          let currentSize = totalSize - expiredKeys.reduce((sum, url) => {
            const m = metaList.find(i => i.url === url);
            return sum + (m?.size || 0);
          }, 0);

          for (const item of metaList) {
            if (currentSize <= this.maxCacheSize) break;
            store.delete(item.url);
            currentSize -= item.size;
          }
        }

        resolve();
      };

      cursorRequest.onerror = () => {
        resolve();
      };
    });
  }

  /**
   * 获取缓存统计信息
   * @returns {Promise<Object>}
   */
  async getStats() {
    try {
      await this.init();
    } catch (e) {
      return { count: 0, totalSize: 0, available: false };
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        const items = request.result;
        const totalSize = items.reduce((sum, item) => sum + (item.size || 0), 0);
        
        resolve({
          count: items.length,
          totalSize: totalSize,
          maxSize: this.maxCacheSize,
          available: true
        });
      };

      request.onerror = () => {
        resolve({ count: 0, totalSize: 0, available: false });
      };
    });
  }

  /**
   * 清空所有缓存
   * @returns {Promise<void>}
   */
  async clear() {
    try {
      await this.init();
    } catch (e) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onsuccess = () => {
        import('../utils/Logger.js').then(({ logInfo }) => {
        }).catch(() => {});
        resolve();
      };

      request.onerror = () => {
        import('../utils/Logger.js').then(({ logError }) => {
          logError('ImageCacheService', '清空缓存失败', request.error);
        }).catch(() => {});
        resolve(); // 失败时不阻塞
      };
    });
  }

  /**
   * 从 URL 加载图片并缓存（使用 img 标签，避免 CORS 问题）
   * @param {string} url - 图片 URL
   * @returns {Promise<string>} 返回 Object URL 或原始 URL，可以直接用于 img.src
   */
  async loadAndCache(url) {
    // 先尝试从缓存获取
    const cachedBlob = await this.get(url);
    if (cachedBlob) {
      return URL.createObjectURL(cachedBlob);
    }

    // 缓存中没有，检查是否是跨域图片
    // 如果是跨域图片且可能不支持 CORS，直接返回原始 URL，让浏览器处理
    const isCrossOrigin = url.startsWith('http://') || url.startsWith('https://');
    const isSameOrigin = isCrossOrigin && url.startsWith(window.location.origin);
    
    // 如果是跨域图片，直接返回原始 URL，避免 CORS 问题
    // 浏览器会自动使用 HTTP 缓存，图片可以正常显示
    if (isCrossOrigin && !isSameOrigin) {
      // 尝试通过 img 标签预加载，但不进行 Canvas 转换
      // 这样可以验证图片是否可以加载，同时避免 CORS 错误
      return new Promise((resolve) => {
        const img = new Image();
        
        // 不设置 crossOrigin，直接加载图片（避免 CORS 错误）
        img.onload = () => {
          // 图片加载成功，返回原始 URL
          // 浏览器会自动使用 HTTP 缓存
          resolve(url);
        };
        
        img.onerror = () => {
          // 图片加载失败，仍然返回原始 URL（让浏览器自己处理）
          resolve(url);
        };
        
        // 开始加载图片（不设置 crossOrigin，避免 CORS 错误）
        img.src = url;
      });
    }
    
    // 同源图片或相对路径，尝试通过 Canvas 转换为 Blob 并缓存
    return new Promise((resolve, reject) => {
      const img = new Image();
      
      img.onload = async () => {
        try {
          // 尝试通过 Canvas 转换为 Blob
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          
          try {
            ctx.drawImage(img, 0, 0);
            // 根据扩展名选择合适的格式，PNG 保留透明度
            const cleanUrl = url.split('?')[0].toLowerCase();
            const isPng = cleanUrl.endsWith('.png');
            const mime = isPng ? 'image/png' : 'image/jpeg';
            const quality = isPng ? undefined : 0.9;
            canvas.toBlob(async (blob) => {
              if (blob) {
                this.set(url, blob).catch(err => {
                  import('../utils/Logger.js').then(({ logWarn }) => {
                  }).catch(() => {});
                });
                const objectUrl = URL.createObjectURL(blob);
                resolve(objectUrl);
              } else {
                resolve(url);
              }
            }, mime, quality);
          } catch (canvasError) {
            // Canvas 操作失败，降级到原始 URL
            resolve(url);
          }
        } catch (error) {
          // 任何错误都降级到原始 URL
          resolve(url);
        }
      };

      img.onerror = () => {
        reject(new Error(`图片加载失败: ${url}`));
      };

      // 开始加载图片
      img.src = url;
    });
  }
}

// 创建并导出全局实例
const imageCacheService = new ImageCacheService();

export default imageCacheService;

