// ===== 分身大赏 - Vue 3 SPA =====

const { createApp, ref, reactive, computed, onMounted, watch, nextTick } = Vue;

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
    compress(file, maxWidth = 800) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    if (img.width <= maxWidth && img.height <= maxWidth) {
                        resolve(e.target.result.split(',')[1]);
                        return;
                    }
                    const canvas = document.createElement('canvas');
                    let w = img.width, h = img.height;
                    if (w > h) { h = (h / w) * maxWidth; w = maxWidth; }
                    else { w = (w / h) * maxWidth; h = maxWidth; }
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
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
                <h1>分身大赏</h1>
                <p>找到你最像的那个人</p>
            </div>
            <div v-if="step === 1" class="login-form">
                <div class="form-group">
                    <label class="form-label">仓库所有者 (GitHub 用户名)</label>
                    <input class="form-input" v-model="repoOwner" placeholder="你的 GitHub 用户名">
                </div>
                <div class="form-group">
                    <label class="form-label">Personal Access Token</label>
                    <input class="form-input" type="password" v-model="token" placeholder="ghp_xxxx" @keyup.enter="verifyToken">
                </div>
                <div class="form-group">
                    <label class="form-label">共享密码</label>
                    <input class="form-input" type="password" v-model="password" placeholder="输入共享密码" @keyup.enter="verifyToken">
                </div>
                <div class="form-group">
                    <label class="form-label">仓库地址 (可选，默认 doppelganger-game)</label>
                    <input class="form-input" v-model="repoName" placeholder="doppelganger-game">
                </div>
                <button class="btn btn-primary btn-full btn-lg" @click="verifyToken" :disabled="!token || !password || !repoOwner">
                    进入
                </button>
                <p v-if="error" style="color: var(--c-error); text-align: center; font-size: 0.9rem;">{{ error }}</p>
            </div>
            <div v-else class="login-form">
                <p style="text-align: center; color: var(--c-gray-400); margin-bottom: var(--sp-4);">选择你的身份</p>
                <div class="nickname-list">
                    <button
                        v-for="m in existingMembers" :key="m"
                        class="nickname-chip"
                        :class="{ active: selectedNickname === m }"
                        @click="selectedNickname = m"
                    >{{ m }}</button>
                </div>
                <div class="form-group" style="margin-top: var(--sp-4);">
                    <label class="form-label">或输入新昵称</label>
                    <input class="form-input" v-model="newNickname" placeholder="你的昵称" @keyup.enter="login">
                </div>
                <button class="btn btn-primary btn-full btn-lg" @click="login" :disabled="!selectedNickname && !newNickname">
                    开始
                </button>
            </div>
        </div>
    `,
    data() {
        return {
            step: 1,
            repoOwner: '',
            repoName: 'doppelganger-game',
            token: '',
            password: '',
            error: '',
            existingMembers: [],
            selectedNickname: '',
            newNickname: ''
        };
    },
    methods: {
        async verifyToken() {
            this.error = '';
            try {
                GitHub.init(this.token, this.repoOwner, this.repoName);
                const { content: config } = await GitHub.getFile('data/config.json');
                if (!Auth.verifyPassword(this.password, config.sharedPassword)) {
                    this.error = '密码错误';
                    return;
                }
                Store.config = config;
                const files = await GitHub.listFiles('data/members');
                this.existingMembers = files.filter(f => f.name.endsWith('.json')).map(f => f.name.replace('.json', ''));
                this.step = 2;
            } catch (e) {
                this.error = '连接失败：' + e.message;
            }
        },
        async login() {
            const nickname = this.newNickname.trim() || this.selectedNickname;
            if (!nickname) return;
            try {
                const isAdmin = Auth.verifyPassword(this.password, Store.config.adminPassword);
                const user = { username: nickname, isAdmin };
                // Create member file if new
                if (!this.existingMembers.includes(nickname)) {
                    await GitHub.createFile(
                        `data/members/${nickname}.json`,
                        { name: nickname, joinedAt: new Date().toISOString() },
                        `新成员加入: ${nickname}`
                    );
                }
                Auth.saveSession(user, this.token, Store.config);
                Store.currentUser = user;
                this.$emit('login');
            } catch (e) {
                this.error = '登录失败：' + e.message;
            }
        }
    }
};

// --- Nav Bar ---
const NavBar = {
    template: `
        <nav class="nav">
            <div class="nav-inner">
                <div class="nav-brand" @click="$emit('navigate', '/')">分身大赏</div>
                <div class="nav-links">
                    <button class="nav-link" :class="{ active: route === '/' }" @click="$emit('navigate', '/')">成员墙</button>
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
                upload: '快上传你找到的分身照片吧',
                vote: '为你最喜欢的分身投票',
                result: '看看谁是年度最佳分身'
            };
            return map[this.season?.phase] || '';
        }
    }
};

// --- Member Wall ---
const MemberWall = {
    template: `
        <div class="container">
            <season-banner :season="season"></season-banner>
            <div class="page-header">
                <h2>成员墙</h2>
                <p>点击成员查看其所有分身</p>
            </div>
            <div class="member-grid">
                <div class="member-card" v-for="m in members" :key="m.username" @click="$emit('view-member', m.username)">
                    <div class="member-avatar">
                        <img v-if="m.avatarUrl" :src="m.avatarUrl" :alt="m.name" loading="lazy">
                        <div v-else class="member-avatar-placeholder" :style="{ background: memberAvatarColor(m.name) }">
                            {{ getInitial(m.name) }}
                        </div>
                    </div>
                    <div class="member-name">{{ m.name }}</div>
                    <div class="member-count">{{ getEntryCount(m.username) }} 个分身</div>
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
                <div class="member-detail-avatar">
                    <img v-if="member && member.avatarUrl" :src="member.avatarUrl" :alt="member.name">
                    <div v-else class="member-avatar-placeholder" :style="{ background: member ? memberAvatarColor(member.name) : '#ccc' }">
                        {{ member ? getInitial(member.name) : '?' }}
                    </div>
                </div>
                <div>
                    <h2>{{ member ? member.name : '未知成员' }}</h2>
                    <p style="color: var(--c-gray-400);">{{ memberEntries.length }} 个分身</p>
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
                <h3>还没有分身</h3>
                <p>去上传页给ta找一个分身吧</p>
            </div>
        </div>
    `,
    props: ['memberId', 'members', 'entries', 'season'],
    computed: {
        member() {
            return this.members.find(m => m.username === this.memberId);
        },
        memberEntries() {
            return this.entries.filter(e => e.targetMember === this.memberId);
        }
    },
    methods: { memberAvatarColor, getInitial }
};

// --- Upload Page ---
const UploadPage = {
    template: `
        <div class="container">
            <season-banner :season="season"></season-banner>
            <div class="upload-section">
                <div class="page-header">
                    <h2>上传分身</h2>
                    <p>找到一个长得像某位成员的人？上传照片吧</p>
                </div>
                <div class="upload-card">
                    <div class="upload-form">
                        <div class="form-group">
                            <label class="form-label">这个分身长得像谁？</label>
                            <select class="form-select" v-model="targetMember">
                                <option value="">选择成员</option>
                                <option v-for="m in members" :key="m.username" :value="m.username">{{ m.name }}</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">分身照片</label>
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
                            提交分身
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
                    await GitHub.uploadImage(imagePath, compressed, `上传分身: ${entryId}`);
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
                        `新增分身作品: ${this.user.username} → ${this.targetMember}`
                    );
                    Store.entries.push({
                        ...entryData,
                        imageUrl: getImageUrl(imagePath)
                    });
                    Store.notify('分身上传成功', 'success');
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
                <p>为你最喜欢的分身投出宝贵一票</p>
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
                            <div v-else class="vote-photo-placeholder">[分身]</div>
                        </div>
                    </div>
                    <div class="vote-info">
                        <div class="vote-meta">
                            <strong>{{ e.targetName }}</strong>
                            <span> 的分身 · 由 {{ e.submitter }} 上传</span>
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
                <p>年度最佳分身花落谁家</p>
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
                        <div class="ranking-title">{{ r.targetName }} 的分身</div>
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
                        <h3>{{ a.name || a.year + ' 分身大赏' }}</h3>
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
        return {
            isLoggedIn: false,
            currentUser: null,
            currentRoute: Store.currentRoute,
            currentSeason: Store.currentSeason,
            members: Store.members,
            entries: Store.entries,
            userVotes: Store.userVotes,
            allVotes: Store.allVotes,
            archives: Store.archives,
            loading: computed(() => Store.loading),
            notification: computed(() => Store.notification)
        };
    },
    async mounted() {
        window.addEventListener('hashchange', () => {
            Store.currentRoute = window.location.hash.slice(1) || '/';
            this.currentRoute = Store.currentRoute;
        });

        // Restore session
        const session = Auth.loadSession();
        if (session) {
            GitHub.init(session.token, session.config.repoOwner, session.config.repoName);
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
        navigate(route) {
            window.location.hash = route;
        },
        viewMember(username) {
            window.location.hash = `/member/${username}`;
        },
        async loadAllData() {
            await Store.setLoading(async () => {
                try {
                    const year = Store.config.currentSeason || new Date().getFullYear().toString();
                    // Load season meta
                    try {
                        const { content: meta } = await GitHub.getFile(`data/seasons/${year}/meta.json`);
                        Store.currentSeason = meta;
                        this.currentSeason = meta;
                    } catch (e) {
                        // No season yet, create default
                        const meta = {
                            name: `${year} 分身大赏`,
                            year,
                            phase: 'upload',
                            startedAt: new Date().toISOString(),
                            uploadDeadline: null,
                            voteDeadline: null,
                            completedAt: null
                        };
                        try {
                            await GitHub.createFile(`data/seasons/${year}/meta.json`, meta, '初始化赛季');
                        } catch (_) {}
                        Store.currentSeason = meta;
                        this.currentSeason = meta;
                    }
                    // Load members
                    const memberFiles = await GitHub.listFiles('data/members');
                    const memberData = await Promise.all(
                        memberFiles.filter(f => f.name.endsWith('.json')).map(async f => {
                            try {
                                const { content } = await GitHub.getFile(`data/members/${f.name}`);
                                const username = f.name.replace('.json', '');
                                return {
                                    ...content,
                                    username,
                                    avatarUrl: getImageUrl(`images/members/${username}.jpg`)
                                };
                            } catch { return null; }
                        })
                    );
                    Store.members = memberData.filter(Boolean);
                    this.members = Store.members;

                    // Load entries
                    const entryFiles = await GitHub.listFiles(`data/seasons/${year}/entries`);
                    const entryData = await Promise.all(
                        entryFiles.filter(f => f.name.endsWith('.json')).map(async f => {
                            try {
                                const { content } = await GitHub.getFile(`data/seasons/${year}/entries/${f.name}`);
                                return {
                                    ...content,
                                    imageUrl: getImageUrl(`images/seasons/${year}/entries/${content.imageName}`)
                                };
                            } catch { return null; }
                        })
                    );
                    Store.entries = entryData.filter(Boolean);
                    this.entries = Store.entries;

                    // Load user's votes
                    if (this.currentUser) {
                        try {
                            const { content: votes, sha } = await GitHub.getFile(`data/seasons/${year}/votes/${this.currentUser.username}.json`);
                            Store.userVotes = { ...votes, _sha: sha };
                            this.userVotes = Store.userVotes;
                        } catch {
                            Store.userVotes = { entryIds: [] };
                            this.userVotes = Store.userVotes;
                        }
                    }

                    // Load all votes (for leaderboard/admin)
                    const voteFiles = await GitHub.listFiles(`data/seasons/${year}/votes`);
                    const allVoteData = await Promise.all(
                        voteFiles.filter(f => f.name.endsWith('.json')).map(async f => {
                            try {
                                const { content } = await GitHub.getFile(`data/seasons/${year}/votes/${f.name}`);
                                return content;
                            } catch { return null; }
                        })
                    );
                    Store.allVotes = allVoteData.filter(Boolean);
                    this.allVotes = Store.allVotes;

                    // Load archives
                    try {
                        const archiveDirs = await GitHub.listFiles('data/archive');
                        const archiveData = await Promise.all(
                            archiveDirs.filter(d => d.type === 'dir').map(async d => {
                                try {
                                    const { content } = await GitHub.getFile(`data/archive/${d.name}/meta.json`);
                                    return content;
                                } catch {
                                    return { year: d.name, name: d.name + ' 分身大赏' };
                                }
                            })
                        );
                        Store.archives = archiveData;
                        this.archives = Store.archives;
                    } catch {
                        Store.archives = [];
                        this.archives = [];
                    }
                } catch (e) {
                    Store.notify('加载数据失败：' + e.message, 'error');
                }
            });
        },
        async handleSubmitEntry(entry) {
            // Already handled in UploadPage
        },
        async handleVote(entryId) {
            // Already handled in VotePage
        },
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
                    this.currentSeason = updated;
                    Store.notify(`已切换到${phase === 'upload' ? '上传期' : phase === 'vote' ? '投票期' : '结果揭晓'}`, 'success');
                } catch (e) {
                    Store.notify('切换阶段失败：' + e.message, 'error');
                }
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
                    // Reload to get new state
                    await this.loadAllData();
                } catch (e) {
                    Store.notify('归档失败：' + e.message, 'error');
                }
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
