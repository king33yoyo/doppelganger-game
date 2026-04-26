// ===== 030精灵捕捉大赛 - Vue 3 SPA =====

const { createApp, ref, reactive, computed, onMounted, watch, nextTick } = Vue;
const bcrypt = window.dcodeIO?.bcrypt || window.bcrypt;

// ===== Utilities =====

function uuid() {
    return 'xxxx-xxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
}

function base64Encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

function base64Decode(b64) {
    return decodeURIComponent(escape(atob(b64)));
}

function getImageUrl(path) {
    if (Store.demoMode) {
        const data = localStorage.getItem('dg_demo_img:' + path);
        return data || '';
    }
    return `https://raw.githubusercontent.com/${Store.config.repoOwner}/${Store.config.repoName}/main/${path}`;
}

function memberAvatarColor(name) {
    const colors = ['#FF6B4A', '#FFB830', '#2ECC71', '#3498DB', '#9B59B6', '#E74C3C', '#1ABC9C', '#F39C12'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

function getInitial(name) {
    return name ? name.charAt(0).toUpperCase() : '?';
}

const ImageUtils = {
    compress(file, maxSizeKB = 1024) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const dataUrl = e.target.result;
                if (Math.round(file.size / 1024) <= maxSizeKB) {
                    resolve(dataUrl.split(',')[1]);
                    return;
                }
                this._compressDataUrl(dataUrl, maxSizeKB, resolve);
            };
            reader.readAsDataURL(file);
        });
    },
    _compressDataUrl(dataUrl, maxSizeKB, resolve, quality = 0.85) {
        const img = new Image();
        img.onload = () => {
            const tryCompress = (w, h, q) => {
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                return canvas.toDataURL('image/jpeg', q).split(',')[1];
            };
            let w = img.width, h = img.height, q = quality;
            let result = tryCompress(w, h, q);
            for (let i = 0; i < 5 && Math.ceil(result.length * 3 / 4 / 1024) > maxSizeKB; i++) {
                q = Math.max(0.3, q - 0.15);
                w = Math.round(w * 0.75); h = Math.round(h * 0.75);
                result = tryCompress(w, h, q);
            }
            resolve(result);
        };
        img.src = dataUrl;
    }
};

// ===== GitHub API Service =====

const GitHub = {
    token: null,
    owner: null,
    repo: null,

    init(token, owner, repo) {
        this.token = token;
        this.owner = owner;
        this.repo = repo;
    },

    headers() {
        return {
            'Authorization': `token ${this.token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        };
    },

    async api(path, options = {}) {
        const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}`;
        const res = await fetch(url, {
            headers: this.headers(),
            ...options
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || `GitHub API error: ${res.status}`);
        }
        return res.json();
    },

    async getFile(path) {
        const data = await this.api(path);
        return {
            content: JSON.parse(base64Decode(data.content)),
            sha: data.sha
        };
    },

    async getFileRaw(path) {
        const data = await this.api(path);
        return { content: data.content, sha: data.sha };
    },

    async createFile(path, content, message) {
        const body = typeof content === 'string'
            ? { message, content: base64Encode(content) }
            : { message, content: typeof content === 'object' ? base64Encode(JSON.stringify(content, null, 2)) : content };
        return this.api(path, { method: 'PUT', body: JSON.stringify(body) });
    },

    async updateFile(path, content, sha, message) {
        const body = typeof content === 'string'
            ? { message, content: base64Encode(content), sha }
            : { message, content: base64Encode(JSON.stringify(content, null, 2)), sha };
        return this.api(path, { method: 'PUT', body: JSON.stringify(body) });
    },

    async deleteFile(path, sha, message) {
        return this.api(path, {
            method: 'DELETE',
            body: JSON.stringify({ message, sha })
        });
    },

    async listFiles(path) {
        try {
            const data = await this.api(path);
            if (Array.isArray(data)) return data;
            return [data];
        } catch (e) {
            if (e.message.includes('404')) return [];
            throw e;
        }
    },

    async uploadImage(imagePath, base64Data, message) {
        return this.api(imagePath, {
            method: 'PUT',
            body: JSON.stringify({ message, content: base64Data })
        });
    }
};

// ===== Demo DB (localStorage backend) =====

const DEMO_NAMES = ['老K','一哥','流利','领袖','都统','白总','王道','守义','老郭','浩原','乐爷','宋总','王总','娄龙'];

const DemoDB = {
    _data: {},
    _imgs: {},

    _path(key) { return 'dg_demo_f:' + key; },
    _imgKey(key) { return 'dg_demo_img:' + key; },

    _save() {
        localStorage.setItem('dg_demo_store', JSON.stringify(this._data));
        for (const [k, v] of Object.entries(this._imgs)) {
            localStorage.setItem(this._imgKey(k), v);
        }
    },

    _load() {
        const saved = localStorage.getItem('dg_demo_store');
        if (saved) { this._data = JSON.parse(saved); return true; }
        return false;
    },

    seed() {
        this._data = {};
        this._imgs = {};
        const year = '2026';
        // Config
        this._data['data/config.json'] = {
            sharedPassword: bcrypt.hashSync('030030', 10),
            adminPassword: bcrypt.hashSync('genius1123', 10),
            currentSeason: year, repoOwner: 'demo', repoName: 'doppelganger-game'
        };
        // Members
        DEMO_NAMES.forEach(name => {
            this._data[`data/members/${name}.json`] = { name, joinedAt: new Date().toISOString() };
        });
        // Season meta
        this._data[`data/seasons/${year}/meta.json`] = {
            name: `${year} 030精灵捕捉大赛`, year, phase: 'upload',
            startedAt: new Date().toISOString(),
            uploadDeadline: null, voteDeadline: null, completedAt: null
        };
        this._save();
    },

    async getFile(path) {
        const data = this._data[path];
        if (!data) throw new Error('404 Not Found');
        return { content: JSON.parse(JSON.stringify(data)), sha: 'demo-sha' };
    },

    async createFile(path, content, message) {
        this._data[path] = typeof content === 'string' ? JSON.parse(content) : JSON.parse(JSON.stringify(content));
        this._save();
        return { content: { sha: 'demo-sha-' + Date.now() } };
    },

    async updateFile(path, content, sha, message) {
        return this.createFile(path, content, message);
    },

    async listFiles(path) {
        const prefix = path + '/';
        const files = [];
        for (const key of Object.keys(this._data)) {
            if (key.startsWith(prefix)) {
                const rest = key.slice(prefix.length);
                if (!rest.includes('/')) {
                    files.push({ name: rest, type: 'file', path: key });
                }
            }
        }
        return files;
    },

    async uploadImage(imagePath, base64Data, message) {
        const dataUrl = 'data:image/jpeg;base64,' + base64Data;
        this._imgs[imagePath] = dataUrl;
        localStorage.setItem(this._imgKey(imagePath), dataUrl);
        return {};
    },

    enable() {
        Store.demoMode = true;
        if (!this._load()) this.seed();
        GitHub.getFile = this.getFile.bind(this);
        GitHub.createFile = this.createFile.bind(this);
        GitHub.updateFile = this.updateFile.bind(this);
        GitHub.listFiles = this.listFiles.bind(this);
        GitHub.uploadImage = this.uploadImage.bind(this);
        GitHub.init = () => {};
    }
};

// ===== Auth Service =====

const Auth = {
    verifyPassword(input, hash) {
        return bcrypt.compareSync(input, hash);
    },

    hashPassword(password) {
        return bcrypt.hashSync(password, 10);
    },

    saveSession(user, token, config) {
        sessionStorage.setItem('dg_user', JSON.stringify(user));
        sessionStorage.setItem('dg_token', token);
        sessionStorage.setItem('dg_config', JSON.stringify(config));
    },

    loadSession() {
        const user = sessionStorage.getItem('dg_user');
        const token = sessionStorage.getItem('dg_token');
        const config = sessionStorage.getItem('dg_config');
        if (!user || !token) return null;
        return {
            user: JSON.parse(user),
            token,
            config: config ? JSON.parse(config) : null
        };
    },

    clearSession() {
        sessionStorage.removeItem('dg_user');
        sessionStorage.removeItem('dg_token');
        sessionStorage.removeItem('dg_config');
    }
};

// ===== Global Store =====

const Store = reactive({
    config: { repoOwner: '', repoName: 'doppelganger-game' },
    currentUser: null,
    demoMode: false,
    currentRoute: window.location.hash.slice(1) || '/',
    currentSeason: null,
    members: [],
    entries: [],
    userVotes: { entryIds: [] },
    allVotes: [],
    archives: [],
    loading: false,
    notification: null,

    notify(message, type = 'info') {
        this.notification = { message, type };
        setTimeout(() => { this.notification = null; }, 3000);
    },

    async setLoading(fn) {
        this.loading = true;
        try {
            return await fn();
        } finally {
            this.loading = false;
        }
    }
});

// ===== Vue Components =====

// --- Login Page ---
const LoginPage = {
    template: `
        <div class="login-card">
            <div class="login-logo">
                <h1><span class="pokeball-icon"></span> 030精灵捕捉大赛</h1>
                <p>找到你最像的那个人</p>
            </div>
            <div v-if="step === 1" class="login-form">
                <div class="form-group">
                    <label class="form-label">密码</label>
                    <input class="form-input" type="password" v-model="password" placeholder="输入密码" @keyup.enter="verifyPassword" autofocus>
                </div>
                <button class="btn btn-primary btn-full btn-lg" @click="verifyPassword" :disabled="!password">
                    进入
                </button>
                <p v-if="error" style="color: var(--c-red); text-align: center; font-size: 0.9rem; margin-top: 12px;">{{ error }}</p>
            </div>
            <div v-else class="login-form">
                <p style="text-align: center; color: var(--c-gray-400); margin-bottom: var(--sp-4);">
                    你好，<strong :style="{ color: isAdmin ? 'var(--c-accent)' : 'var(--c-primary)' }">{{ isAdmin ? '管理员' : '成员' }}</strong>，选择你的身份
                </p>
                <div class="nickname-list">
                    <button v-for="m in existingMembers" :key="m" class="nickname-chip"
                        :class="{ active: selectedNickname === m }" @click="selectedNickname = m">{{ m }}</button>
                </div>
                <button class="btn btn-primary btn-full btn-lg" @click="login" :disabled="!selectedNickname" style="margin-top: var(--sp-5);">
                    开始
                </button>
            </div>
        </div>
    `,
    data() {
        return { step: 1, password: '', error: '', existingMembers: [], selectedNickname: '', isAdmin: false };
    },
    methods: {
        async demoLogin() {
            this.error = '';
            try {
                localStorage.removeItem('dg_demo_store');
                DemoDB.enable();
                this.password = '030030';
                this.isAdmin = false;
                const { content: config } = await GitHub.getFile('data/config.json');
                Store.config = config;
                const files = await GitHub.listFiles('data/members');
                this.existingMembers = files.filter(f => f.name.endsWith('.json')).map(f => f.name.replace('.json', ''));
                this.step = 2;
            } catch (e) { this.error = '启动失败：' + e.message; }
        },
        async verifyPassword() {
            this.error = '';
            if (this.password === 'genius1123') {
                this.isAdmin = true;
                if (Store.demoMode) { await this._loadDemoMembers(); } else { await this._loadProdMembers(); }
                const user = { username: '老K', isAdmin: true };
                Auth.saveSession(user, Store.demoMode ? 'demo' : 'production', Store.config);
                Store.currentUser = user;
                this.$emit('login');
                return;
            }
            if (this.password === '030030') { this.isAdmin = false; }
            else { this.error = '密码错误'; return; }
            if (Store.demoMode) { await this._loadDemoMembers(); this.step = 2; return; }
            try {
                await this._loadProdMembers();
                this.step = 2;
            } catch (e) { this.error = '连接失败：' + e.message; }
        },
        async _loadDemoMembers() {
            const files = await GitHub.listFiles('data/members');
            this.existingMembers = files.filter(f => f.name.endsWith('.json')).map(f => f.name.replace('.json', ''));
        },
        async _loadProdMembers() {
            const { content: config } = await GitHub.getFile('data/config.json');
            Store.config = config;
            const files = await GitHub.listFiles('data/members');
            this.existingMembers = files.filter(f => f.name.endsWith('.json')).map(f => f.name.replace('.json', ''));
        },
        async login() {
            if (!this.selectedNickname) return;
            const user = { username: this.selectedNickname, isAdmin: this.isAdmin };
            Auth.saveSession(user, Store.demoMode ? 'demo' : 'production', Store.config);
            Store.currentUser = user;
            this.$emit('login');
        }
    }
};

// --- Nav Bar ---
const NavBar = {
    template: `
        <nav class="nav">
            <div class="nav-inner">
                <div class="nav-brand" @click="$emit('navigate', '/')"><span class="pokeball-sm"></span> 030精灵捕捉大赛</div>
                <div class="nav-links">
                    <button class="nav-link" :class="{ active: route === '/' }" @click="$emit('navigate', '/')">成员图鉴</button>
                    <button class="nav-link" :class="{ active: route === '/upload', disabled: phase !== 'upload' }" @click="phase === 'upload' && $emit('navigate', '/upload')">
                        上传<span class="badge badge-upload" v-if="phase === 'upload'">开放</span>
                    </button>
                    <button class="nav-link" :class="{ active: route === '/vote', disabled: phase !== 'vote' }" @click="phase === 'vote' && $emit('navigate', '/vote')">
                        投票<span class="badge badge-vote" v-if="phase === 'vote'">开放</span>
                    </button>
                    <button class="nav-link" :class="{ active: route === '/leaderboard', disabled: phase !== 'result' }" @click="phase === 'result' && $emit('navigate', '/leaderboard')">
                        排行榜<span class="badge badge-result" v-if="phase === 'result'">揭晓</span>
                    </button>
                    <button class="nav-link" :class="{ active: route === '/history' }" @click="$emit('navigate', '/history')">历史</button>
                    <button class="nav-link" v-if="user && user.isAdmin" :class="{ active: route === '/admin' }" @click="$emit('navigate', '/admin')">管理</button>
                </div>
                <div class="nav-user">
                    <div class="nav-avatar" :style="{ background: memberAvatarColor(user.username) }">{{ getInitial(user.username) }}</div>
                    <span class="nav-username">{{ user.username }}</span>
                    <button class="nav-logout" @click="$emit('logout')">退出</button>
                </div>
            </div>
        </nav>
    `,
    props: ['user', 'season'],
    computed: {
        route() { return Store.currentRoute; },
        phase() { return this.season ? this.season.phase : ''; }
    },
    methods: {
        memberAvatarColor,
        getInitial
    }
};

// --- Season Banner ---
const SeasonBanner = {
    template: `
        <div v-if="season" class="season-banner" :class="'phase-' + season.phase">
            <div class="season-info">
                <h2>{{ season.name }}</h2>
                <p>{{ phaseLabel }}</p>
            </div>
            <div class="season-phase" :class="'phase-' + season.phase">
                <span class="phase-dot"></span>
                <span class="phase-text">{{ phaseText }}</span>
            </div>
        </div>
    `,
    props: ['season'],
    computed: {
        phaseText() {
            const map = { upload: '上传期', vote: '投票期', result: '结果揭晓' };
            return map[this.season?.phase] || '';
        },
        phaseLabel() {
            const map = {
                upload: '快上传你找到的精灵照片吧',
                vote: '为你最喜欢的精灵投票',
                result: '看看谁是年度最佳精灵'
            };
            return map[this.season?.phase] || '';
        }
    }
};

// --- Member Wall ---
const TYPE_COLORS = ['#F08030','#6890F0','#78C850','#F8D030','#C03028','#98D8D8','#F85888','#B8B8D0','#B8A038','#E0C068','#78C850','#A040A0','#E0C068','#7038F8'];

const MemberWall = {
    template: `
        <div class="container">
            <season-banner :season="season"></season-banner>
            <div class="page-header">
                <h2>成员图鉴</h2>
                <p>点击成员查看其所有精灵</p>
            </div>
            <div class="member-grid">
                <div class="member-card"
                     v-for="(m, idx) in members" :key="m.username"
                     :style="{ '--card-type-color': getTypeColor(idx) }"
                     @click="$emit('view-member', m.username)">
                    <div class="member-card-strip" :style="{ background: 'linear-gradient(90deg, ' + getTypeColor(idx) + ', ' + getTypeColor(idx) + '88)' }"></div>
                    <div class="member-card-body">
                        <div class="member-dex-num">#{{ String(idx + 1).padStart(3, '0') }}</div>
                        <div class="member-avatar">
                            <img v-if="m.avatarUrl" :src="m.avatarUrl" :alt="m.name" loading="lazy">
                            <div v-else class="member-avatar-placeholder" :style="{ background: memberAvatarColor(m.name) }">
                                {{ getInitial(m.name) }}
                            </div>
                        </div>
                        <div class="member-name">{{ m.name }}</div>
                        <div class="member-count">
                            <span class="pokeball-tiny"></span>
                            {{ getEntryCount(m.username) }} 个精灵
                        </div>
                    </div>
                </div>
            </div>
            <div v-if="members.length === 0" class="empty-state">
                <div class="empty-state-icon">[avatar]</div>
                <h3>还没有成员</h3>
                <p>成为第一个加入的吧</p>
            </div>
        </div>
    `,
    props: ['members', 'entries', 'season'],
    methods: {
        memberAvatarColor,
        getInitial,
        getTypeColor(idx) { return TYPE_COLORS[idx % TYPE_COLORS.length]; },
        getEntryCount(username) {
            return this.entries.filter(e => e.targetMember === username).length;
        }
    },
    components: { 'season-banner': SeasonBanner }
};

// --- Member Detail ---
const MemberDetail = {
    template: `
        <div class="container">
            <button class="back-btn" @click="$emit('back')">← 返回成员墙</button>
            <div class="member-detail-header">
                <div class="member-detail-avatar" style="position:relative;cursor:pointer;" @click="canUploadAvatar && $refs.avatarInput.click()">
                    <img v-if="member && member.avatarUrl" :src="member.avatarUrl" :alt="member.name">
                    <div v-else class="member-avatar-placeholder" :style="{ background: member ? memberAvatarColor(member.name) : '#ccc', width: '100%', height: '100%' }">
                        {{ member ? getInitial(member.name) : '?' }}
                    </div>
                    <div v-if="canUploadAvatar && !member?.avatarUrl" style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.5);color:#fff;font-size:0.75rem;text-align:center;padding:4px;">上传头像</div>
                </div>
                <input type="file" ref="avatarInput" accept="image/*" style="display:none" @change="uploadAvatar">
                <div>
                    <h2>{{ member ? member.name : '未知成员' }}</h2>
                    <p style="color: var(--c-gray-400);">{{ memberEntries.length }} 个精灵</p>
                </div>
            </div>
            <div class="entry-grid">
                <div class="entry-card" v-for="e in memberEntries" :key="e.id">
                    <div class="entry-photo">
                        <img v-if="e.imageUrl" :src="e.imageUrl" loading="lazy">
                        <div v-else class="vote-photo-placeholder">[照片]</div>
                    </div>
                    <div class="entry-meta">由 <strong>{{ e.submitter }}</strong> 上传</div>
                </div>
            </div>
            <div v-if="memberEntries.length === 0" class="empty-state">
                <div class="empty-state-icon">[photo]</div>
                <h3>还没有精灵</h3>
                <p>去上传页给ta找一个精灵吧</p>
            </div>
        </div>
    `,
    props: ['memberId', 'members', 'entries', 'season', 'currentUser'],
    computed: {
        member() {
            return this.members.find(m => m.username === this.memberId);
        },
        memberEntries() {
            return this.entries.filter(e => e.targetMember === this.memberId);
        },
        canUploadAvatar() {
            if (!this.currentUser || !this.member) return false;
            return this.currentUser.username === this.memberId || this.currentUser.isAdmin;
        }
    },
    methods: {
        memberAvatarColor, getInitial,
        async uploadAvatar(e) {
            const file = e.target.files[0];
            if (!file || !this.member) return;
            await Store.setLoading(async () => {
                try {
                    const compressed = await ImageUtils.compress(file, 400);
                    const imagePath = `images/members/${this.memberId}.jpg`;
                    await GitHub.uploadImage(imagePath, compressed, `上传头像: ${this.memberId}`);
                    Store.notify('头像上传成功，刷新后生效', 'success');
                    this.$emit('avatar-uploaded');
                } catch (err) {
                    Store.notify('头像上传失败：' + err.message, 'error');
                }
            });
        }
    }
};

// --- Upload Page ---
const UploadPage = {
    template: `
        <div class="container">
            <season-banner :season="season"></season-banner>
            <div class="upload-section">
                <div class="page-header">
                    <h2>上传精灵</h2>
                    <p>找到一个长得像某位成员的人？上传照片吧</p>
                </div>
                <div class="upload-card">
                    <div class="upload-form">
                        <div class="form-group">
                            <label class="form-label">这个精灵长得像谁？</label>
                            <select class="form-select" v-model="targetMember">
                                <option value="">选择成员</option>
                                <option v-for="m in members" :key="m.username" :value="m.username">{{ m.name }}</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">精灵照片</label>
                            <div v-if="!previewUrl" class="upload-dropzone" :class="{ dragover: isDragover }"
                                @click="$refs.fileInput.click()"
                                @dragover.prevent="isDragover = true"
                                @dragleave="isDragover = false"
                                @drop.prevent="handleDrop">
                                <div class="upload-dropzone-icon">[upload]</div>
                                <div class="upload-dropzone-text">点击或拖拽照片到这里<br><strong>支持 JPG、PNG</strong></div>
                            </div>
                            <div v-else class="upload-preview">
                                <img :src="previewUrl" alt="预览">
                                <button class="upload-preview-remove" @click="removeFile">×</button>
                            </div>
                            <input type="file" ref="fileInput" accept="image/*" style="display:none" @change="handleFileSelect">
                        </div>
                        <button class="btn btn-primary btn-full btn-lg" @click="submit"
                            :disabled="!targetMember || !selectedFile">
                            提交精灵
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `,
    props: ['members', 'season', 'user'],
    data() {
        return {
            targetMember: '',
            selectedFile: null,
            previewUrl: '',
            isDragover: false
        };
    },
    methods: {
        handleFileSelect(e) {
            const file = e.target.files[0];
            if (file) this.processFile(file);
        },
        handleDrop(e) {
            this.isDragover = false;
            const file = e.dataTransfer.files[0];
            if (file) this.processFile(file);
        },
        processFile(file) {
            if (!file.type.startsWith('image/')) {
                Store.notify('请选择图片文件', 'error');
                return;
            }
            this.selectedFile = file;
            this.previewUrl = URL.createObjectURL(file);
        },
        removeFile() {
            this.selectedFile = null;
            this.previewUrl = '';
        },
        async submit() {
            if (!this.targetMember || !this.selectedFile) return;
            await Store.setLoading(async () => {
                try {
                    const entryId = uuid();
                    const ext = this.selectedFile.name.split('.').pop() || 'jpg';
                    const year = this.season.year;
                    const imagePath = `images/seasons/${year}/entries/${entryId}.${ext}`;
                    const compressed = await ImageUtils.compress(this.selectedFile);
                    await GitHub.uploadImage(imagePath, compressed, `上传精灵: ${entryId}`);
                    const entryData = {
                        id: entryId,
                        submitter: this.user.username,
                        targetMember: this.targetMember,
                        imageName: `${entryId}.${ext}`,
                        createdAt: new Date().toISOString()
                    };
                    await GitHub.createFile(
                        `data/seasons/${year}/entries/${entryId}.json`,
                        entryData,
                        `新增精灵作品: ${this.user.username} → ${this.targetMember}`
                    );
                    Store.entries.push({
                        ...entryData,
                        imageUrl: getImageUrl(imagePath)
                    });
                    Store.notify('精灵上传成功', 'success');
                    this.targetMember = '';
                    this.removeFile();
                } catch (e) {
                    Store.notify('上传失败：' + e.message, 'error');
                }
            });
        }
    },
    components: { 'season-banner': SeasonBanner }
};

// --- Vote Page ---
const VotePage = {
    template: `
        <div class="container">
            <season-banner :season="season"></season-banner>
            <div class="page-header">
                <h2>投票</h2>
                <p>为你最喜欢的精灵投出宝贵一票</p>
            </div>
            <div class="vote-status">
                <span>已投 {{ votedCount }}/3 票</span>
                <div class="vote-progress">
                    <span class="vote-dot" :class="{ filled: i < votedCount }" v-for="i in 3" :key="i"></span>
                </div>
            </div>
            <div class="vote-grid">
                <div class="vote-card" v-for="e in entriesWithTarget" :key="e.id">
                    <div class="vote-compare">
                        <div class="vote-photo">
                            <img v-if="e.targetAvatarUrl" :src="e.targetAvatarUrl" loading="lazy">
                            <div v-else class="vote-photo-placeholder" :style="{ background: memberAvatarColor(e.targetMember) }">
                                {{ getInitial(e.targetName) }}
                            </div>
                        </div>
                        <span class="vote-vs">VS</span>
                        <div class="vote-photo">
                            <img v-if="e.imageUrl" :src="e.imageUrl" loading="lazy">
                            <div v-else class="vote-photo-placeholder">[精灵]</div>
                        </div>
                    </div>
                    <div class="vote-info">
                        <div class="vote-meta">
                            <strong>{{ e.targetName }}</strong>
                            <span> 的精灵 · 由 {{ e.submitter }} 上传</span>
                        </div>
                        <button class="vote-btn" :class="{ voted: isVoted(e.id) }"
                            :disabled="!isVoted(e.id) && votedCount >= 3"
                            @click="toggleVote(e.id)">
                            {{ isVoted(e.id) ? '已投' : '投票' }}
                        </button>
                    </div>
                </div>
            </div>
            <div v-if="entriesWithTarget.length === 0" class="empty-state">
                <div class="empty-state-icon">[vote]</div>
                <h3>暂无参赛作品</h3>
                <p>上传期结束后再来投票</p>
            </div>
        </div>
    `,
    props: ['entries', 'members', 'votes', 'season', 'user'],
    computed: {
        votedCount() {
            return (this.votes && this.votes.entryIds) ? this.votes.entryIds.length : 0;
        },
        entriesWithTarget() {
            return this.entries.map(e => {
                const target = this.members.find(m => m.username === e.targetMember);
                return {
                    ...e,
                    targetName: target ? target.name : e.targetMember,
                    targetAvatarUrl: target ? target.avatarUrl : null
                };
            });
        }
    },
    methods: {
        memberAvatarColor,
        getInitial,
        isVoted(entryId) {
            return (this.votes && this.votes.entryIds && this.votes.entryIds.includes(entryId)) || false;
        },
        async toggleVote(entryId) {
            if (this.isVoted(entryId)) return;
            if (this.votedCount >= 3) {
                Store.notify('已经投满 3 票了', 'info');
                return;
            }
            await Store.setLoading(async () => {
                try {
                    const year = this.season.year;
                    const newEntryIds = [...(this.votes.entryIds || []), entryId];
                    const voteData = {
                        voter: this.user.username,
                        entryIds: newEntryIds,
                        votedAt: new Date().toISOString()
                    };
                    if (this.votes._sha) {
                        await GitHub.updateFile(
                            `data/seasons/${year}/votes/${this.user.username}.json`,
                            voteData,
                            this.votes._sha,
                            `${this.user.username} 投票`
                        );
                    } else {
                        await GitHub.createFile(
                            `data/seasons/${year}/votes/${this.user.username}.json`,
                            voteData,
                            `${this.user.username} 投票`
                        );
                    }
                    Store.userVotes = { ...voteData, entryIds: newEntryIds };
                    Store.notify('投票成功', 'success');
                } catch (e) {
                    Store.notify('投票失败：' + e.message, 'error');
                }
            });
        }
    },
    components: { 'season-banner': SeasonBanner }
};

// --- Leaderboard Page ---
const LeaderboardPage = {
    template: `
        <div class="container">
            <season-banner :season="season"></season-banner>
            <div class="page-header">
                <h2>排行榜</h2>
                <p>年度最佳精灵花落谁家</p>
            </div>
            <div class="leaderboard-list">
                <div class="ranking-card" v-for="(r, i) in rankings" :key="r.id"
                    :class="{ first: i === 0 }">
                    <div class="ranking-number">{{ i + 1 }}</div>
                    <div class="ranking-photos">
                        <div class="ranking-photo">
                            <img v-if="r.targetAvatarUrl" :src="r.targetAvatarUrl" loading="lazy">
                            <div v-else class="member-avatar-placeholder" :style="{ background: memberAvatarColor(r.targetName) }">
                                {{ getInitial(r.targetName) }}
                            </div>
                        </div>
                        <div class="ranking-photo">
                            <img v-if="r.imageUrl" :src="r.imageUrl" loading="lazy">
                            <div v-else class="member-avatar-placeholder">[photo]</div>
                        </div>
                    </div>
                    <div class="ranking-details">
                        <div class="ranking-title">{{ r.targetName }} 的精灵</div>
                        <div class="ranking-sub">由 {{ r.submitter }} 上传</div>
                    </div>
                    <div class="ranking-votes">
                        <span class="ranking-vote-count">{{ r.voteCount }}</span>
                        <span class="ranking-vote-label">票</span>
                    </div>
                </div>
            </div>
            <div v-if="rankings.length === 0" class="empty-state">
                <div class="empty-state-icon">[trophy]</div>
                <h3>结果尚未揭晓</h3>
                <p>投票期结束后由管理员开启结果</p>
            </div>
        </div>
    `,
    props: ['entries', 'members', 'allVotes', 'season'],
    computed: {
        rankings() {
            const voteCount = {};
            this.allVotes.forEach(v => {
                (v.entryIds || []).forEach(eid => {
                    voteCount[eid] = (voteCount[eid] || 0) + 1;
                });
            });
            return this.entries
                .map(e => {
                    const target = this.members.find(m => m.username === e.targetMember);
                    return {
                        ...e,
                        targetName: target ? target.name : e.targetMember,
                        targetAvatarUrl: target ? target.avatarUrl : null,
                        voteCount: voteCount[e.id] || 0
                    };
                })
                .sort((a, b) => b.voteCount - a.voteCount);
        }
    },
    methods: { memberAvatarColor, getInitial },
    components: { 'season-banner': SeasonBanner }
};

// --- History Page ---
const HistoryPage = {
    template: `
        <div class="container">
            <div class="page-header">
                <h2>历史赛季</h2>
                <p>回顾往届精彩瞬间</p>
            </div>
            <div class="history-grid">
                <div class="history-card" v-for="a in archives" :key="a.year" @click="viewArchive(a)">
                    <div class="history-cover">
                        <span class="history-year">{{ a.year }}</span>
                    </div>
                    <div class="history-info">
                        <h3>{{ a.name || a.year + ' 030精灵捕捉大赛' }}</h3>
                        <p>{{ a.entryCount || 0 }} 个作品 · {{ a.voteCount || 0 }} 人参与投票</p>
                    </div>
                </div>
            </div>
            <div v-if="archives.length === 0" class="empty-state">
                <div class="empty-state-icon">[archive]</div>
                <h3>暂无历史赛季</h3>
                <p>第一个赛季结束后会出现在这里</p>
            </div>
        </div>
    `,
    props: ['archives', 'members'],
    methods: {
        viewArchive(archive) {
            Store.notify('历史赛季详情页开发中', 'info');
        }
    }
};

// --- Admin Panel ---
const AdminPanel = {
    template: `
        <div class="container">
            <div class="page-header">
                <h2>管理面板</h2>
                <p>控制赛季流程</p>
            </div>
            <div class="admin-grid">
                <div class="admin-card">
                    <h3>阶段管理</h3>
                    <div class="phase-indicator" :class="season.phase">
                        当前阶段：{{ phaseLabel }}
                    </div>
                    <div class="admin-actions">
                        <button class="btn btn-outline btn-full" @click="$emit('change-phase', 'upload')"
                            :disabled="season.phase === 'upload'">切换到上传期</button>
                        <button class="btn btn-accent btn-full" @click="$emit('change-phase', 'vote')"
                            :disabled="season.phase === 'vote'">切换到投票期</button>
                        <button class="btn btn-success btn-full" @click="$emit('change-phase', 'result')"
                            :disabled="season.phase === 'result'">揭晓结果</button>
                    </div>
                </div>
                <div class="admin-card">
                    <h3>投票进度</h3>
                    <p style="font-size: 0.9rem; color: var(--c-gray-400); margin-bottom: var(--sp-4);">
                        {{ votedMembers.length }}/{{ members.length }} 人已投票
                    </p>
                    <ul class="vote-progress-list">
                        <li class="vote-progress-item" v-for="m in members" :key="m.username">
                            <span :class="hasVoted(m.username) ? 'progress-check' : 'progress-cross'">
                                {{ hasVoted(m.username) ? '✓' : '—' }}
                            </span>
                            <span>{{ m.name }}</span>
                        </li>
                    </ul>
                </div>
                <div class="admin-card">
                    <h3>赛季操作</h3>
                    <div class="admin-actions">
                        <button class="btn btn-danger btn-full" @click="$emit('archive-season')"
                            :disabled="season.phase !== 'result'">
                            归档当前赛季
                        </button>
                    </div>
                    <div style="margin-top: var(--sp-4); font-size: 0.85rem; color: var(--c-gray-300);">
                        <p>作品数：{{ entries.length }}</p>
                        <p>投票数：{{ allVotes.length }}</p>
                    </div>
                </div>
            </div>
        </div>
    `,
    props: ['season', 'members', 'allVotes', 'entries'],
    computed: {
        phaseLabel() {
            const map = { upload: '上传期', vote: '投票期', result: '结果期' };
            return map[this.season?.phase] || '未知';
        },
        votedMembers() {
            return this.allVotes.map(v => v.voter);
        }
    },
    methods: {
        hasVoted(username) {
            return this.votedMembers.includes(username);
        }
    }
};

// ===== Main App =====

const app = createApp({
    data() {
        return { isLoggedIn: false, currentUser: null };
    },
    computed: {
        currentRoute: () => Store.currentRoute,
        currentSeason: () => Store.currentSeason,
        members: () => Store.members,
        entries: () => Store.entries,
        userVotes: () => Store.userVotes,
        allVotes: () => Store.allVotes,
        archives: () => Store.archives,
        loading: () => Store.loading,
        notification: () => Store.notification
    },
    async mounted() {
        window.addEventListener('hashchange', () => {
            Store.currentRoute = window.location.hash.slice(1) || '/';
        });
        const session = Auth.loadSession();
        if (session) {
            if (session.token === 'demo') {
                DemoDB.enable();
            } else {
                GitHub.init(session.token, session.config.repoOwner, session.config.repoName);
            }
            Store.config = session.config;
            Store.currentUser = session.user;
            this.currentUser = session.user;
            this.isLoggedIn = true;
            await this.loadAllData();
        }
    },
    methods: {
        async handleLogin() {
            const session = Auth.loadSession();
            if (session) {
                Store.currentUser = session.user;
                this.currentUser = session.user;
                this.isLoggedIn = true;
                await this.loadAllData();
            }
        },
        handleLogout() {
            Auth.clearSession();
            Store.currentUser = null;
            Store.members = [];
            Store.entries = [];
            Store.allVotes = [];
            this.currentUser = null;
            this.isLoggedIn = false;
        },
        navigate(route) { window.location.hash = route; },
        viewMember(username) { window.location.hash = `/member/${username}`; },
        async loadAllData() {
            await Store.setLoading(async () => {
                try {
                    const year = Store.config.currentSeason || new Date().getFullYear().toString();
                    try {
                        const { content: meta } = await GitHub.getFile(`data/seasons/${year}/meta.json`);
                        Store.currentSeason = meta;
                    } catch (e) {
                        const meta = {
                            name: `${year} 030精灵捕捉大赛`, year, phase: 'upload',
                            startedAt: new Date().toISOString(),
                            uploadDeadline: null, voteDeadline: null, completedAt: null
                        };
                        try { await GitHub.createFile(`data/seasons/${year}/meta.json`, meta, '初始化赛季'); } catch (_) {}
                        Store.currentSeason = meta;
                    }
                    const memberFiles = await GitHub.listFiles('data/members');
                    const memberData = await Promise.all(
                        memberFiles.filter(f => f.name.endsWith('.json')).map(async f => {
                            try {
                                const { content } = await GitHub.getFile(`data/members/${f.name}`);
                                const username = f.name.replace('.json', '');
                                return { ...content, username, avatarUrl: getImageUrl(`images/members/${username}.jpg`) };
                            } catch { return null; }
                        })
                    );
                    Store.members = memberData.filter(Boolean);

                    const entryFiles = await GitHub.listFiles(`data/seasons/${year}/entries`);
                    const entryData = await Promise.all(
                        entryFiles.filter(f => f.name.endsWith('.json')).map(async f => {
                            try {
                                const { content } = await GitHub.getFile(`data/seasons/${year}/entries/${f.name}`);
                                return { ...content, imageUrl: getImageUrl(`images/seasons/${year}/entries/${content.imageName}`) };
                            } catch { return null; }
                        })
                    );
                    Store.entries = entryData.filter(Boolean);

                    if (this.currentUser) {
                        try {
                            const { content: votes, sha } = await GitHub.getFile(`data/seasons/${year}/votes/${this.currentUser.username}.json`);
                            Store.userVotes = { ...votes, _sha: sha };
                        } catch { Store.userVotes = { entryIds: [] }; }
                    }

                    const voteFiles = await GitHub.listFiles(`data/seasons/${year}/votes`);
                    const allVoteData = await Promise.all(
                        voteFiles.filter(f => f.name.endsWith('.json')).map(async f => {
                            try { const { content } = await GitHub.getFile(`data/seasons/${year}/votes/${f.name}`); return content; }
                            catch { return null; }
                        })
                    );
                    Store.allVotes = allVoteData.filter(Boolean);

                    try {
                        const archiveDirs = await GitHub.listFiles('data/archive');
                        const archiveData = await Promise.all(
                            archiveDirs.filter(d => d.type === 'dir').map(async d => {
                                try { const { content } = await GitHub.getFile(`data/archive/${d.name}/meta.json`); return content; }
                                catch { return { year: d.name, name: d.name + ' 030精灵捕捉大赛' }; }
                            })
                        );
                        Store.archives = archiveData;
                    } catch { Store.archives = []; }
                } catch (e) {
                    Store.notify('加载数据失败：' + e.message, 'error');
                }
            });
        },
        async handleSubmitEntry() {},
        async handleVote() {},
        async handleChangePhase(phase) {
            await Store.setLoading(async () => {
                try {
                    const year = Store.currentSeason.year;
                    const { content: meta, sha } = await GitHub.getFile(`data/seasons/${year}/meta.json`);
                    const updated = { ...meta, phase };
                    if (phase === 'vote') updated.uploadDeadline = new Date().toISOString();
                    if (phase === 'result') updated.voteDeadline = new Date().toISOString();
                    await GitHub.updateFile(`data/seasons/${year}/meta.json`, updated, sha, `切换阶段: ${phase}`);
                    Store.currentSeason = updated;
                    Store.notify(`已切换到${phase === 'upload' ? '上传期' : phase === 'vote' ? '投票期' : '结果揭晓'}`, 'success');
                } catch (e) { Store.notify('切换阶段失败：' + e.message, 'error'); }
            });
        },
        async handleArchiveSeason() {
            await Store.setLoading(async () => {
                try {
                    const year = Store.currentSeason.year;
                    const { content: meta, sha } = await GitHub.getFile(`data/seasons/${year}/meta.json`);
                    const completed = { ...meta, completedAt: new Date().toISOString() };
                    await GitHub.updateFile(`data/seasons/${year}/meta.json`, completed, sha, '归档赛季');
                    Store.notify('赛季已归档', 'success');
                    await this.loadAllData();
                } catch (e) { Store.notify('归档失败：' + e.message, 'error'); }
            });
        }
    }
});

// Register components
app.component('login-page', LoginPage);
app.component('nav-bar', NavBar);
app.component('member-wall', MemberWall);
app.component('member-detail', MemberDetail);
app.component('upload-page', UploadPage);
app.component('vote-page', VotePage);
app.component('leaderboard-page', LeaderboardPage);
app.component('history-page', HistoryPage);
app.component('admin-panel', AdminPanel);

app.mount('#app');
