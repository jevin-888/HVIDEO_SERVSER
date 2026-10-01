// API service. The page always talks to the server that served it.

class ApiService {
    constructor() {
        this.baseUrl = '/api/v1';
        this.token = localStorage.getItem('admin_token');
    }

    setToken(token) {
        this.token = token;
        localStorage.setItem('admin_token', token);
    }

    clearToken() {
        this.token = null;
        localStorage.removeItem('admin_token');
    }

    getHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        return headers;
    }

    async request(endpoint, options = {}) {
        const { responseType = 'json', ...fetchOptions } = options;
        try {
            const url = `${this.baseUrl}${endpoint}`;
            const headers = {
                ...this.getHeaders(),
                ...fetchOptions.headers
            };
            if (fetchOptions.body instanceof FormData) {
                delete headers['Content-Type'];
            }
            const config = {
                ...fetchOptions,
                headers
            };

            const response = await fetch(url, config);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                if (response.status === 401) {
                    this.clearToken();
                    const isLoginRequest = endpoint === '/auth/login';
                    if (!isLoginRequest) {
                        const loginPage = document.getElementById('login-page');
                        const adminPage = document.getElementById('admin-page');
                        if (loginPage && adminPage) {
                            loginPage.classList.remove('hidden');
                            adminPage.classList.add('hidden');
                        }
                    }
                    throw new Error(errorData.message || (isLoginRequest
                        ? '用户名或密码错误'
                        : '登录已过期，请重新登录'));
                }
                throw new Error(errorData.message || `请求失败: ${response.status}`);
            }

            return responseType === 'blob' ? await response.blob() : await response.json();
        } catch (error) {
            console.error('API请求错误:', error);
            throw error;
        }
    }

    // 服务器授权（一项 API 对应一个方法）
    async getLicenseStatus() {
        return this.request('/license/status');
    }

    async importLicense(content) {
        return this.request('/license/import', {
            method: 'POST',
            body: JSON.stringify({ content })
        });
    }

    // 认证相关
    async login(username, password) {

        const data = await this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ clientKey: username, clientSecret: password })
        });

        if (data.data && data.data.token) {
            this.setToken(data.data.token);
        }

        return data;
    }

    logout() {
        this.clearToken();
    }

    // 歌曲相关
    async getSongs(query = {}) {
        const params = new URLSearchParams(query).toString();
        const endpoint = `/songs${params ? `?${params}` : ''}`;
        return this.request(endpoint);
    }

    async getSong(id) {
        return this.request(`/songs/${id}`);
    }

    async createSong(songData) {
        return this.request('/songs', {
            method: 'POST',
            body: JSON.stringify(songData)
        });
    }

    async updateSong(id, songData) {
        return this.request(`/songs/${id}`, {
            method: 'PUT',
            body: JSON.stringify(songData)
        });
    }

    async deleteSong(id) {
        return this.request(`/songs/${id}`, {
            method: 'DELETE'
        });
    }

    // 歌星相关
    async getArtists(query = {}) {
        const params = new URLSearchParams(query).toString();
        const endpoint = `/artists${params ? `?${params}` : ''}`;
        return this.request(endpoint);
    }

    async getArtist(id) {
        return this.request(`/artists/${id}`);
    }

    async createArtist(artistData) {
        return this.request('/artists', {
            method: 'POST',
            body: JSON.stringify(artistData)
        });
    }

    async updateArtist(id, artistData) {
        return this.request(`/artists/${id}`, {
            method: 'PUT',
            body: JSON.stringify(artistData)
        });
    }

    async deleteArtist(id) {
        return this.request(`/artists/${id}`, {
            method: 'DELETE'
        });
    }

    // 房间相关
    async getRooms() {
        return this.request('/rooms');
    }

    async getRoom(id) {
        return this.request(`/rooms/${id}`);
    }

    async createRoom(roomData) {
        return this.request('/rooms', {
            method: 'POST',
            body: JSON.stringify(roomData)
        });
    }

    async updateRoom(id, roomData) {
        return this.request(`/rooms/${id}`, {
            method: 'PUT',
            body: JSON.stringify(roomData)
        });
    }

    async deleteRoom(id) {
        return this.request(`/rooms/${id}`, {
            method: 'DELETE'
        });
    }

    async getPadOrderingStatus() {
        return this.request('/admin/pad-ordering/status');
    }

    async updatePadOrderingStatus(enabled) {
        return this.request('/admin/pad-ordering/status', {
            method: 'PUT',
            body: JSON.stringify({ enabled: Boolean(enabled) })
        });
    }

    async getRoomQueue(roomId) {
        return this.request(`/rooms/${roomId}/queue`);
    }

    async getRoomClientConnections(query = {}) {
        const params = new URLSearchParams(query).toString();
        return this.request(`/system/room-client-connections${params ? `?${params}` : ''}`);
    }

    async addToQueue(roomId, songId, isPriority = false) {
        return this.request(`/rooms/${roomId}/queue`, {
            method: 'POST',
            body: JSON.stringify({ songNo: songId, isPriority: isPriority })
        });
    }

    async nextSong(roomId) {
        return this.request(`/rooms/${roomId}/next`, {
            method: 'POST'
        });
    }

    async clearQueue(roomId) {
        return this.request(`/rooms/${roomId}/clear`, {
            method: 'POST'
        });
    }

    async play(roomId) {
        return this.request(`/rooms/${roomId}/play`, { method: 'POST' });
    }

    async pause(roomId) {
        return this.request(`/rooms/${roomId}/pause`, { method: 'POST' });
    }

    async replay(roomId) {
        return this.request(`/rooms/${roomId}/replay`, { method: 'POST' });
    }

    async skip(roomId) {
        // /skip is reserved for player EOF notifications and requires queueItemId.
        // Manual admin skipping uses the authoritative /next transition.
        return this.nextSong(roomId);
    }

    async setVolume(roomId, volume) {
        return this.request(`/rooms/${roomId}/volume`, {
            method: 'POST',
            body: JSON.stringify({ volume })
        });
    }

    async setMic(roomId, enabled) {
        return this.request(`/rooms/${roomId}/mic`, {
            method: 'POST',
            body: JSON.stringify({ enabled })
        });
    }

    async switchTrack(roomId, trackId) {
        return this.request(`/rooms/${roomId}/track`, {
            method: 'POST',
            body: JSON.stringify({ trackId })
        });
    }

    async setMute(roomId, enabled) {
        return this.request(`/rooms/${roomId}/command`, {
            method: 'POST',
            body: JSON.stringify({ action: enabled ? 'Mute' : 'Unmute' })
        });
    }

    async sendCommand(roomId, command) {
        return this.request(`/rooms/${roomId}/command`, {
            method: 'POST',
            body: JSON.stringify(command)
        });
    }

    // 外设控制
    async controlAc(roomId, data) {
        return this.request(`/rooms/${roomId}/peripheral/ac`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async controlLight(roomId, data) {
        return this.request(`/rooms/${roomId}/peripheral/light`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async controlEffect(roomId, data) {
        return this.request(`/rooms/${roomId}/peripheral/effect`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async playAmbiance(roomId, data) {
        return this.request(`/rooms/${roomId}/peripheral/ambiance`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async serviceCall(roomId, data) {
        return this.request(`/rooms/${roomId}/peripheral/call`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    // 终端相关
    async getTerminals() {
        return this.request('/terminals');
    }

    async getTerminalConfigProfiles() {
        return this.request('/terminals/config-profiles');
    }

    async captureTerminalConfig(id, mode) {
        return this.request(`/terminals/${encodeURIComponent(id)}/config-profile`, {
            method: 'POST', body: JSON.stringify({ mode })
        });
    }

    async startAppUpdate(apk, terminalIds, allowDowngrade = false) {
        const body = new FormData();
        body.append('terminalIds', JSON.stringify(terminalIds));
        body.append('allowDowngrade', String(allowDowngrade));
        body.append('apk', apk);
        return this.request('/terminals/app-updates', { method: 'POST', body });
    }

    async getLatestAppUpdate() {
        return this.request('/terminals/app-updates/latest');
    }

    async getRomReleases() {
        return this.request('/rom-updates/releases');
    }

    async setRomPublication(releaseId, published) {
        return this.request(`/rom-updates/releases/${encodeURIComponent(releaseId)}/publication`, {
            method: 'PUT', body: JSON.stringify({ published })
        });
    }

    async getAppUpdate(taskId) {
        return this.request(`/terminals/app-updates/${encodeURIComponent(taskId)}`);
    }

    async getTerminal(id) {
        return this.request(`/terminals/${id}`);
    }

    async updateTerminal(id, terminalData) {
        return this.request(`/terminals/${id}`, {
            method: 'PUT',
            body: JSON.stringify(terminalData)
        });
    }

    async deleteTerminal(id) {
        return this.request(`/terminals/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async scanNetwork() {
        return this.request('/terminals/discover', {
            method: 'POST'
        });
    }

    async registerTerminal(terminalData) {
        return this.request('/terminals/register', {
            method: 'POST',
            body: JSON.stringify(terminalData)
        });
    }


    // Cloud sync API fields use one camelCase contract.
    async getCloudConfig() {
        return this.request('/cloud/config');
    }

    async saveCloudConfig(config) {
        return this.request('/cloud/config', { method: 'PUT', body: JSON.stringify(config) });
    }

    async startCloudUpdates() {
        return this.request('/cloud/updates', { method: 'POST' });
    }

    async getCloudStatus() {
        return this.request('/cloud/status');
    }

    async batchImport(songIds) {
        return this.request('/cloud/import', {
            method: 'POST',
            body: JSON.stringify({ songIds })
        });
    }

    async getSyncTasks(query = {}) {
        const params = new URLSearchParams();
        if (query.taskType) params.set('taskType', query.taskType);
        if (query.status !== undefined && query.status !== '') params.set('status', String(query.status));
        if (query.page) params.set('page', String(query.page));
        if (query.pageSize) params.set('pageSize', String(query.pageSize));
        const qs = params.toString();
        return this.request(`/cloud/tasks${qs ? `?${qs}` : ''}`);
    }

    async triggerDownload(taskId) {
        return this.request(`/cloud/download/${encodeURIComponent(taskId)}`, {
            method: 'POST'
        });
    }

    async getStreams() {
        return this.request('/streams');
    }

    async getStreamsStatus() {
        return this.request('/streams/status');
    }

    async refreshStreams() {
        return this.request('/streams/refresh', { method: 'POST' });
    }


    // ===== 歌曲库 (song.db) =====
    async searchSongDb(query = {}) {
        const params = new URLSearchParams(query).toString();
        return this.request(`/songdb/songs${params ? `?${params}` : ''}`);
    }

    async getSongDbSong(id, query = {}) {
        const params = new URLSearchParams(query).toString();
        return this.request(`/songdb/songs/${id}${params ? `?${params}` : ''}`);
    }

    async createSongDbSong(data) {
        return this.request('/songdb/songs', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async updateSongDbSong(id, data) {
        return this.request(`/songdb/songs/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    async deleteSongDbSong(id) {
        return this.request(`/songdb/songs/${id}`, {
            method: 'DELETE'
        });
    }

    async searchSingerDb(query = {}) {
        const params = new URLSearchParams(query).toString();
        return this.request(`/songdb/singers${params ? `?${params}` : ''}`);
    }

    async getSingerDbSinger(id) {
        return this.request(`/songdb/singers/${id}`);
    }

    async createSingerDbSinger(data) {
        return this.request('/songdb/singers', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async updateSingerDbSinger(id, data) {
        return this.request(`/songdb/singers/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    async deleteSingerDbSinger(id) {
        return this.request(`/songdb/singers/${id}`, {
            method: 'DELETE'
        });
    }

    async uploadSingerImage(id, file) {
        const formData = new FormData();
        formData.append('image', file);
        
        const token = localStorage.getItem('token');
        const options = {
            method: 'POST',
            body: formData
        };
        
        let url = `${this.baseUrl}/songdb/singers/${id}/image`;
        if (token) {
            options.headers = {
                'Authorization': `Bearer ${token}`
            };
        }
        
        const response = await fetch(url, options);
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.message || `请求失败 (${response.status})`);
        }
        
        try {
            return await response.json();
        } catch {
            return {};
        }
    }

    async getSingerSongs(singerId, query = {}) {
        const params = new URLSearchParams(query).toString();
        return this.request(`/songdb/singers/${singerId}/songs${params ? `?${params}` : ''}`);
    }

    async getSongDbDict(group) {
        return this.request(`/songdb/dict/${encodeURIComponent(group)}`);
    }

    async upsertSongDbDict(group, data) {
        return this.request(`/songdb/dict/${encodeURIComponent(group)}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    async deleteSongDbDict(group, code) {
        return this.request(`/songdb/dict/${encodeURIComponent(group)}/${encodeURIComponent(code)}`, {
            method: 'DELETE'
        });
    }

    async getSongDbDicts() {
        return this.request('/songdb/dicts');
    }

    async exportSongDbDicts(dictGroup = '') {
        const query = dictGroup ? `?${new URLSearchParams({ dictGroup })}` : '';
        return this.request(`/songdb/dicts/export${query}`, { responseType: 'blob' });
    }

    async importSongDbDicts(file) {
        const body = new FormData();
        body.append('file', file, file.name);
        return this.request('/songdb/dicts/import', { method: 'POST', body });
    }

    async getSongDbStats() {
        return this.request('/songdb/stats');
    }
    async importSongCatalog(file) {
        const formData = new FormData();
        formData.append('file', file, file.name);
        return this.request('/songdb/import', {
            method: 'POST',
            body: formData
        });
    }

    async getSongImportTask(taskId) {
        return this.request(`/songdb/import/tasks/${encodeURIComponent(taskId)}`);
    }

    async getActiveSongImport() {
        return this.request('/songdb/import/active');
    }

    async importSingerCatalog(file) {
        const formData = new FormData();
        formData.append('file', file, file.name);
        return this.request('/songdb/singers/import', {
            method: 'POST',
            body: formData
        });
    }

    async getSingerImportTask(taskId) {
        return this.request(`/songdb/singers/import/tasks/${encodeURIComponent(taskId)}`);
    }

    async getActiveSingerImport() {
        return this.request('/songdb/singers/import/active');
    }

    async startSingerImageMatch(directory, overwrite = false) {
        return this.request('/songdb/singers/image-match/start', {
            method: 'POST',
            body: JSON.stringify({ directory, overwrite })
        });
    }

    async getSingerImageMatchProgress(taskId) {
        return this.request(`/songdb/singers/image-match/progress/${encodeURIComponent(taskId)}`);
    }

    async getSingerImageMatchResult(taskId) {
        return this.request(`/songdb/singers/image-match/result/${encodeURIComponent(taskId)}`);
    }

    async cancelSingerImageMatch(taskId) {
        return this.request(`/songdb/singers/image-match/cancel/${encodeURIComponent(taskId)}`, {
            method: 'POST'
        });
    }

    // ==================== 房间配置管理 ====================

    async getRoomTypes() {
        return this.request('/rooms/configs/types');
    }

    async createRoomType(name) {
        return this.request('/rooms/configs/types', {
            method: 'POST',
            body: JSON.stringify({ name })
        });
    }

    async deleteRoomType(id) {
        return this.request(`/rooms/configs/types/${id}`, {
            method: 'DELETE'
        });
    }

    async getRoomAreas() {
        return this.request('/rooms/configs/areas');
    }

    async createRoomArea(name) {
        return this.request('/rooms/configs/areas', {
            method: 'POST',
            body: JSON.stringify({ name })
        });
    }

    async deleteRoomArea(id) {
        return this.request(`/rooms/configs/areas/${id}`, {
            method: 'DELETE'
        });
    }

    // 系统设置：获取本机服务器地址与端口（用于自动填充）
    async getServerInfo() {
        return this.request('/system/server-info');
    }

    async updateServerNetwork(host, port) {
        return this.request('/system/server-network', {
            method: 'PUT',
            body: JSON.stringify({ host, port })
        });
    }

    // 最近活动
    async getActivities(limit = 20) {
        return this.request(`/activities?limit=${limit}`);
    }

    async clearActivities() {
        return this.request('/activities', { method: 'DELETE' });
    }

    async getSystemStatus() {
        return this.request('/system/status');
    }

    // ==================== 中控配置 ====================

    async getPeripherals() {
        return this.request('/admin/peripherals');
    }

    async getPeripheralState(roomId) {
        return this.request(`/admin/peripherals/${roomId}`);
    }

    async setRoomLight(roomId, ctrlType, code) {
        return this.request(`/admin/peripherals/${roomId}/light`, {
            method: 'PUT',
            body: JSON.stringify({ ctrlType, code })
        });
    }

    async setRoomAc(roomId, power, temp, mode) {
        return this.request(`/admin/peripherals/${roomId}/ac`, {
            method: 'PUT',
            body: JSON.stringify({ power, temp, mode })
        });
    }

    async setRoomEffect(roomId, mode) {
        return this.request(`/admin/peripherals/${roomId}/effect`, {
            method: 'PUT',
            body: JSON.stringify({ mode })
        });
    }

    async batchSetLight(ctrlType, code, roomIds) {
        const body = { ctrlType, code };
        if (roomIds) body.roomIds = roomIds;
        return this.request('/admin/peripherals/batch/light', {
            method: 'POST',
            body: JSON.stringify(body)
        });
    }

    async batchSetAc(power, temp, mode, roomIds) {
        const body = { power, temp, mode };
        if (roomIds) body.roomIds = roomIds;
        return this.request('/admin/peripherals/batch/ac', {
            method: 'POST',
            body: JSON.stringify(body)
        });
    }

    // ==================== 外设品类预设 ====================

    async getPeripheralPresets(type) {
        const qs = type ? `?type=${encodeURIComponent(type)}` : '';
        return this.request(`/peripheral/presets${qs}`);
    }

    async createPeripheralPreset(data) {
        return this.request('/admin/peripheral-presets', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async updatePeripheralPreset(id, data) {
        return this.request(`/admin/peripheral-presets/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    async deletePeripheralPreset(id) {
        return this.request(`/admin/peripheral-presets/${id}`, { method: 'DELETE' });
    }

    // ==================== 服务铃管理 ====================

    async getServiceCalls() {
        return this.request('/admin/service-calls');
    }

    async completeServiceCall(id) {
        return this.request(`/admin/service-calls/${id}/complete`, { method: 'PUT' });
    }

    // ==================== 歌曲路径对照 ====================

    async scanIdleMedia(query = {}) {
        const params = new URLSearchParams(query).toString();
        return this.request(`/idle-media/scan${params ? `?${params}` : ''}`);
    }

    async startScan(directory, deleteDuplicates = false, incremental = false) {
        return this.request('/songdb/scan/start', {
            method: 'POST',
            body: JSON.stringify({ directory, deleteDuplicates, incremental })
        });
    }

    async getScanRoots() {
        return this.request('/songdb/scan/fs');
    }

    async getScanProgress(taskId) {
        return this.request(`/songdb/scan/progress/${taskId}`);
    }

    async getScanResult(taskId) {
        return this.request(`/songdb/scan/result/${taskId}`);
    }

    async cancelScan(taskId) {
        return this.request(`/songdb/scan/cancel/${taskId}`, { method: 'POST' });
    }

    /** 从当前实际 API 地址一对一推导扫描 WebSocket 地址 */
    getScanWsUrl(taskId) {
        const apiUrl = new URL(this.baseUrl, window.location.href);
        apiUrl.protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        apiUrl.pathname = `/ws/scan/${encodeURIComponent(taskId)}`;
        apiUrl.search = this.token ? `?token=${encodeURIComponent(this.token)}` : '';
        apiUrl.hash = '';
        return apiUrl.toString();
    }
}

// 导出API服务实例
const apiService = new ApiService();
window.apiService = apiService;


