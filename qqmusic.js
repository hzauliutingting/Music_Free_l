"use strict";

const axios = require("axios");
const cheerio = require("cheerio");
const CryptoJs = require("crypto-js");
const he = require("he");
const qs = require("qs");
const bigInt = require("big-integer");
const dayjs = require("dayjs");

const pageSize = 20;

// 配置常用请求头
const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                  "AppleWebKit/537.36 (KHTML, like Gecko) " +
                  "Chrome/106.0.0.0 Safari/537.36",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "zh-CN,zh;q=0.9",
};

// 通用的HTTP GET请求函数
async function httpGet(url, params = {}) {
    try {
        const response = await axios.get(url, {
            headers,
            params,
        });
        return response.data;
    } catch (error) {
        console.error(`HTTP GET 请求失败: ${error.message}`);
        throw error;
    }
}

// 数据格式化函数
function formatMusicItem(item) {
    return {
        id: item.songid,
        title: he.decode(item.songname),
        artist: item.singername,
        album: item.albumname,
        duration: item.interval,
        artwork: item.albumimg,
    };
}

function formatAlbumItem(item) {
    return {
        id: item.albumid,
        title: he.decode(item.albumname),
        artist: item.singername,
        artwork: item.albumimg,
        publishTime: dayjs.unix(item.public_time / 1000).format("YYYY-MM-DD"),
    };
}

function formatSheetItem(item) {
    return {
        id: item.id,
        title: he.decode(item.title),
        description: he.decode(item.desc),
        coverImg: item.cover,
        creator: item.creator ? item.creator.nickname : "",
        playCount: item.listenCount,
    };
}

// 密钥生成函数
function create_key() {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let key = "";
    for (let i = 0; i < 16; i++) {
        const randIndex = Math.floor(Math.random() * chars.length);
        key += chars.charAt(randIndex);
    }
    return key;
}

// AES加密函数
function AES(a, b) {
    const key = CryptoJs.enc.Utf8.parse(b);
    const iv = CryptoJs.enc.Utf8.parse("0102030405060708");
    const encrypted = CryptoJs.AES.encrypt(CryptoJs.enc.Utf8.parse(a), key, {
        iv: iv,
        mode: CryptoJs.mode.CBC,
        padding: CryptoJs.pad.Pkcs7,
    });
    return encrypted.toString();
}

// RSA加密函数
function Rsa(text) {
    text = text.split("").reverse().join("");
    const e = "010001"; // 公钥指数
    const n = "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";
    const hexText = Buffer.from(text, 'utf-8').toString('hex');
    const res = bigInt(hexText, 16)
        .modPow(bigInt(e, 16), bigInt(n, 16))
        .toString(16);
    return res.padStart(256, '0');
}

// 获取加密参数
function getParamsAndEnc(text) {
    const first = AES(text, "0CoJUm6Qyw8W8jud");
    const rand = create_key();
    const params = AES(first, rand);
    const encSecKey = Rsa(rand);
    return {
        params,
        encSecKey,
    };
}

// 搜索基础函数
async function searchBase(query, page, type) {
    const data = {
        s: query,
        limit: pageSize,
        type: type,
        offset: (page - 1) * pageSize,
        csrf_token: "",
    };
    const encrypted = getParamsAndEnc(JSON.stringify(data));
    const paeData = qs.stringify(encrypted);
    const postHeaders = {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded",
    };
    try {
        const res = await axios.post("https://music.163.com/weapi/search/get", paeData, {
            headers: postHeaders,
        });
        return res.data;
    } catch (error) {
        console.error(`搜索失败: ${error.message}`);
        throw error;
    }
}

// 搜索音乐
async function searchMusic(query, page) {
    const res = await searchBase(query, page, 1);
    const songs = res.result.songs.map(formatMusicItem);
    return {
        isEnd: res.result.songCount <= page * pageSize,
        data: songs,
    };
}

// 搜索专辑
async function searchAlbum(query, page) {
    const res = await searchBase(query, page, 10);
    const albums = res.result.albums.map(formatAlbumItem);
    return {
        isEnd: res.result.albumCount <= page * pageSize,
        data: albums,
    };
}

// 搜索歌单
async function searchSheet(query, page) {
    const res = await searchBase(query, page, 6);
    const sheets = res.result.playlists.map(formatSheetItem);
    return {
        isEnd: res.result.playlistCount <= page * pageSize,
        data: sheets,
    };
}

// 获取媒体源
async function getMediaSource(musicItem, quality = "standard") {
    const qualityLevels = {
        low: "128k",
        standard: "320k",
        high: "320k",
        super: "320k",
    };
    try {
        const response = await axios.get(`https://lxmusicapi.onrender.com/url/wy/${musicItem.id}/${qualityLevels[quality]}`, {
            headers: {
                "X-Request-Key": "share-v2"
            },
        });
        return {
            url: response.data.url,
        };
    } catch (error) {
        console.error(`获取媒体源失败: ${error.message}`);
        throw error;
    }
}

// 获取排行榜
async function getTopLists() {
    try {
        const res = await axios.get("https://music.163.com/discover/toplist", {
            headers: {
                "Referer": "https://music.163.com/",
                "User-Agent": headers["User-Agent"],
            },
        });
        const $ = cheerio.load(res.data);
        const children = $(".n-minelst").children();
        const groups = [];
        let currentGroup = {};
        children.each((index, element) => {
            const tag = $(element).prop("tagName").toLowerCase();
            if (tag === "h2") {
                if (currentGroup.title) {
                    groups.push(currentGroup);
                }
                currentGroup = {};
                currentGroup.title = $(element).text().trim();
                currentGroup.data = [];
            } else if (tag === "ul") {
                $(element).children("li").each((i, el) => {
                    const id = $(el).attr("data-res-id");
                    const coverImg = $(el).find("img").attr("src").replace(/(\.jpg\?).*/, ".jpg?param=800y800");
                    const title = $(el).find("p.name").text().trim();
                    const description = $(el).find("p.s-fc4").text().trim();
                    currentGroup.data.push({
                        id,
                        coverImg,
                        title,
                        description,
                    });
                });
            }
        });
        if (currentGroup.title) {
            groups.push(currentGroup);
        }
        return groups;
    } catch (error) {
        console.error(`获取排行榜失败: ${error.message}`);
        throw error;
    }
}

// 获取排行榜详情
async function getTopListDetail(topListItem) {
    try {
        const url = "https://music.163.com/weapi/v1/playlist/detail";
        const data = {
            id: topListItem.id,
            n: 1000,
            csrf_token: "",
        };
        const encrypted = getParamsAndEnc(JSON.stringify(data));
        const paeData = qs.stringify(encrypted);
        const postHeaders = {
            ...headers,
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": "https://music.163.com/",
        };
        const res = await axios.post(url, paeData, {
            headers: postHeaders,
        });
        const songs = res.data.playlist.trackIds.map(item => item.id);
        // 批量获取歌曲详情
        const musicDetails = await getValidMusicItems(songs);
        return {
            ...topListItem,
            musicList: musicDetails,
        };
    } catch (error) {
        console.error(`获取排行榜详情失败: ${error.message}`);
        throw error;
    }
}

// 获取有效的音乐项
async function getValidMusicItems(trackIds) {
    const headers = {
        "Referer": "https://music.163.com/",
        "User-Agent": headers["User-Agent"],
    };
    try {
        const res = await axios.get(`https://music.163.com/api/song/detail/?ids=[${trackIds.join(",")}]`, { headers });
        const validMusicItems = res.data.songs.map(formatMusicItem);
        return validMusicItems;
    } catch (error) {
        console.error(`获取有效音乐项失败: ${error.message}`);
        return [];
    }
}

// 获取歌词
async function getLyric(musicItem) {
    try {
        const url = "https://music.163.com/weapi/song/lyric";
        const data = {
            id: musicItem.id,
            lv: -1,
            tv: -1,
            csrf_token: "",
        };
        const encrypted = getParamsAndEnc(JSON.stringify(data));
        const paeData = qs.stringify(encrypted);
        const postHeaders = {
            ...headers,
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": "https://music.163.com/",
        };
        const res = await axios.post(url, paeData, {
            headers: postHeaders,
        });
        if (res.data.lrc && res.data.lrc.lyric) {
            return {
                rawLrc: he.decode(Buffer.from(res.data.lrc.lyric, 'base64').toString('utf-8')),
            };
        } else {
            return {
                rawLrc: "",
            };
        }
    } catch (error) {
        console.error(`获取歌词失败: ${error.message}`);
        throw error;
    }
}

// 获取专辑信息
async function getAlbumInfo(albumItem, page = 1) {
    try {
        const url = "https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg";
        const params = {
            albummid: albumItem.id,
            format: "json",
        };
        const data = await httpGet(url, params);
        const songs = data.data.list.map(formatMusicItem);
        return {
            isEnd: true, // QQ音乐专辑通常一次性返回所有歌曲
            data: songs,
        };
    } catch (error) {
        console.error(`获取专辑信息失败: ${error.message}`);
        throw error;
    }
}

// 导入歌单
async function importMusicSheet(urlLike) {
    const matchResult = urlLike.match(/(?:https:\/\/y\.music\.163\.com\/m\/playlist\?id=([0-9]+))|(?:https?:\/\/music\.163\.com\/playlist\/([0-9]+)\/.*)|(?:https?:\/\/music\.163.com(?:\/#)?\/playlist\?id=(\d+))|(?:^\s*(\d+)\s*$)/);
    const id = matchResult[1] || matchResult[2] || matchResult[3] || matchResult[4];
    if (!id) {
        console.error("未能解析歌单ID");
        return [];
    }
    try {
        const musicList = await getSheetMusicById(id);
        return musicList;
    } catch (error) {
        console.error(`导入歌单失败: ${error.message}`);
        return [];
    }
}

// 获取歌单中的音乐
async function getSheetMusicById(id) {
    const headers = {
        "Referer": "https://music.163.com/",
        "User-Agent": headers["User-Agent"],
    };
    try {
        const sheetDetail = await axios.get(`https://music.163.com/api/v3/playlist/detail?id=${id}&n=5000`, { headers });
        const trackIds = sheetDetail.data.playlist.trackIds.map(item => item.id);
        let result = [];
        let idx = 0;
        while (idx * 200 < trackIds.length) {
            const batchIds = trackIds.slice(idx * 200, (idx + 1) * 200);
            const res = await getValidMusicItems(batchIds);
            result = result.concat(res);
            idx++;
        }
        return result;
    } catch (error) {
        console.error(`获取歌单音乐失败: ${error.message}`);
        return [];
    }
}

// 模块导出
module.exports = {
    platform: "QQ音乐",
    version: "1.0.0",
    author: "Huibq",
    appVersion: ">0.1.0",
    srcUrl: "https://raw.githubusercontent.com/hzauliutingting/Music_Free_l/main/qqmusic.js",
    cacheControl: "no-cache",
    description: "QQ音乐的Node.js模块，支持搜索音乐、专辑、歌单，获取媒体源、排行榜及其详情、歌词等功能。",
    primaryKey: ["id"],
    supportedSearchType: ["music", "album", "sheet"],
    async search(query, page, type) {
        if (type === "music") {
            return await searchMusic(query, page);
        } else if (type === "album") {
            return await searchAlbum(query, page);
        } else if (type === "sheet") {
            return await searchSheet(query, page);
        } else {
            throw new Error(`Unsupported search type: ${type}`);
        }
    },
    getMediaSource,
    getTopLists,
    getTopListDetail,
    getLyric,
    getAlbumInfo,
    importMusicSheet,
};
