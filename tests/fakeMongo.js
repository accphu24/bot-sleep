// Bản giả lập tối giản của MongoDB (chỉ đủ các toán tử mà utils/db.js dùng) để chạy test không cần máy chủ thật.
const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

function matchValue(docVal, cond) {
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof RegExp)) {
        return Object.entries(cond).every(([op, v]) => {
            if (op === '$ne') return docVal !== v;
            if (op === '$lte') return docVal <= v;
            if (op === '$regex') return new RegExp(v).test(String(docVal));
            throw new Error('Toán tử filter chưa hỗ trợ: ' + op);
        });
    }
    return docVal === cond;
}
const matches = (doc, filter) => Object.entries(filter).every(([k, c]) => matchValue(doc[k], c));

function project(doc, projection) {
    if (!doc) return doc;
    const out = clone(doc);
    if (!projection) return out;
    const entries = Object.entries(projection);
    if (entries.every(([, v]) => v === 0)) {
        for (const [k] of entries) delete out[k];
        return out;
    }
    const keep = { _id: out._id };
    for (const [k, v] of entries) if (v && k in out) keep[k] = out[k];
    return keep;
}

function applyUpdate(doc, update) {
    for (const [k, v] of Object.entries(update.$set || {})) doc[k] = clone(v);
    for (const k of Object.keys(update.$unset || {})) delete doc[k];
    for (const [k, v] of Object.entries(update.$inc || {})) doc[k] = (doc[k] || 0) + v;
}

class FakeCollection {
    constructor() { this.docs = []; }
    async createIndex() { return 'ok'; }
    _find(filter) { return this.docs.filter(d => matches(d, filter || {})); }

    find(filter = {}, opts = {}) {
        let result = () => this._find(filter).map(d => project(d, opts.projection));
        const cursor = {
            _sort: null, _limit: null,
            sort(spec) { this._sort = spec; return this; },
            limit(n) { this._limit = n; return this; },
            async toArray() {
                let arr = result();
                if (this._sort) {
                    const [[k, dir]] = Object.entries(this._sort);
                    arr.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir);
                }
                if (this._limit) arr = arr.slice(0, this._limit);
                return arr;
            }
        };
        return cursor;
    }

    async findOne(filter, opts = {}) {
        const d = this._find(filter)[0];
        return d ? project(d, opts.projection) : null;
    }

    _upsertDoc(filter, update) {
        const doc = {};
        for (const [k, c] of Object.entries(filter)) if (!(c && typeof c === 'object')) doc[k] = c;
        for (const [k, v] of Object.entries(update.$setOnInsert || {})) doc[k] = clone(v);
        applyUpdate(doc, update);
        this.docs.push(doc);
        return doc;
    }

    async updateOne(filter, update, opts = {}) {
        const d = this._find(filter)[0];
        if (d) {
            const before = JSON.stringify(d);
            applyUpdate(d, update);
            return { matchedCount: 1, modifiedCount: before === JSON.stringify(d) ? 0 : 1, upsertedCount: 0 };
        }
        if (opts.upsert) { this._upsertDoc(filter, update); return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }; }
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }

    async replaceOne(filter, doc, opts = {}) {
        const i = this.docs.findIndex(d => matches(d, filter));
        if (i >= 0) { this.docs[i] = { ...clone(doc), _id: this.docs[i]._id }; return { matchedCount: 1 }; }
        if (opts.upsert) { this.docs.push({ ...clone(doc), _id: filter._id }); return { upsertedCount: 1 }; }
        return { matchedCount: 0 };
    }

    async findOneAndUpdate(filter, update, opts = {}) {
        let d = this._find(filter)[0];
        if (!d) {
            if (!opts.upsert) return null;
            const before = null;
            const created = this._upsertDoc(filter, update);
            return opts.returnDocument === 'before' ? before : project(created, opts.projection);
        }
        const before = clone(d);
        applyUpdate(d, update);
        return project(opts.returnDocument === 'before' ? before : d, opts.projection);
    }

    async findOneAndDelete(filter) {
        const i = this.docs.findIndex(d => matches(d, filter));
        if (i < 0) return null;
        return this.docs.splice(i, 1)[0];
    }

    async deleteOne(filter) {
        const i = this.docs.findIndex(d => matches(d, filter));
        if (i >= 0) this.docs.splice(i, 1);
        return { deletedCount: i >= 0 ? 1 : 0 };
    }

    async deleteMany(filter) {
        const keep = this.docs.filter(d => !matches(d, filter));
        const deleted = this.docs.length - keep.length;
        this.docs = keep;
        return { deletedCount: deleted };
    }
}

class FakeDb {
    constructor() { this.cols = {}; }
    collection(name) { return (this.cols[name] ||= new FakeCollection()); }
}

class FakeMongoClient {
    constructor() { FakeMongoClient.last = this; this._db = new FakeDb(); }
    async connect() {}
    async close() {}
    db() { return this._db; }
}

module.exports = { FakeMongoClient };
