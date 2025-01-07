"use strict";

const axios = require("axios");
const cheerio = require("cheerio");
const CryptoJs = require("crypto-js");
const he = require("he");

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
        publishTime: item.public_time,
    };
}

function formatSheetItem(item) {
    return {
        id: item.id,
        title: he.decode(item.title),
        description: he.decode(item.desc),
        coverImg: item.cover,
        creator: item.creator,
        playCount: item.listenCount,
    };
}

// 搜索音乐
async function searchMusic(query, page) {
    const url = "https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp";
    const params = {
        w: query,
        p: page,
        n: pageSize,
        format: "json",
        aggr: 1,
        cr: 1,
        catZhida: 1,
        lossless: 0,
        flag_qc: 0,
        remoteplace: "txt.yqq.center",
    };

    const data = await httpGet(url, params);
    const songs = data.data.song.list.map(formatMusicItem);
    return {
        isEnd: (page * pageSize) >= data.data.song.totalnum,
        data: songs,
    };
}

// 搜索专辑
async function searchAlbum(query, page) {
    const url = "https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp";
    const params = {
        w: query,
        p: page,
        n: pageSize,
        format: "json",
        aggr: 1,
        cr: 1,
        catZhida: 1,
        lossless: 0,
        flag_qc: 0,
        remoteplace: "txt.yqq.center",
        t: 8, // 搜索类型为专辑
    };

    const data = await httpGet(url, params);
    const albums = data.data.album.list.map(formatAlbumItem);
    return {
        isEnd: (page * pageSize) >= data.data.album.totalnum,
        data: albums,
    };
}

// 搜索歌单
async function searchSheet(query, page) {
    const url = "https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp";
    const params = {
        w: query,
        p: page,
        n: pageSize,
        format: "json",
        aggr: 1,
        cr: 1,
        catZhida: 1,
        lossless: 0,
        flag_qc: 0,
        remoteplace: "txt.yqq.center",
        t: 6, // 搜索类型为歌单
    };

    const data = await httpGet(url, params);
    const sheets = data.data.diss.list.map(formatSheetItem);
    return {
        isEnd: (page * pageSize) >= data.data.diss.totalnum,
        data: sheets,
    };
}

// 获取媒体源
async function getMediaSource(musicItem) {
    try {
        // 获取歌曲播放URL的API
        const url = "https://u.y.qq.com/cgi-bin/musicu.fcg";
        const params = {
            format: "json",
        };
        const postData = {
            "comm": {
                "uin": 0,
                "format": "json",
                "ct": 24,
                "cv": 0
            },
            "songinfo": {
                "method": "get_song_detail_yqq",
                "param": {
                    "song_type": 0,
                    "song_mid": musicItem.id,
                    "song_id": musicItem.id
                },
                "module": "music.pf_song_detail_svr",
                "data": {}
            }
        };

        const response = await axios.post(url, postData, { headers });
        const songData = response.data.data.songinfo.data[0];
        if (songData && songData.url) {
            return {
                url: songData.url,
            };
        } else {
            console.error("未能获取到媒体源URL");
            return null;
        }
    } catch (error) {
        console.error(`获取媒体源失败: ${error.message}`);
        throw error;
    }
}

// 获取排行榜
async function getTopLists() {
    try {
        const url = "https://c.y.qq.com/v8/fcg-bin/fcg_myqq_toplist.fcg";
        const params = {
            platform: "yqq",
            format: "json",
        };

        const data = await httpGet(url, params);
        const lists = data.data.topList.map(item => ({
            id: item.topId,
            title: he.decode(item.title),
            coverImg: item.picUrl,
            playCount: item.listenCount,
            description: he.decode(item.content),
        }));

        return lists;
    } catch (error) {
        console.error(`获取排行榜失败: ${error.message}`);
        throw error;
    }
}

// 获取排行榜详情
async function getTopListDetail(topListItem) {
    try {
        const url = "https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg";
        const params = {
            topid: topListItem.id,
            format: "json",
            page: "detail",
            type: "top",
            tpl: 3,
            json: 1,
            onlysong: 0,
        };

        const data = await httpGet(url, params);
        const songs = data.songlist.map(item => formatMusicItem(item.data));
        return {
            ...topListItem,
            musicList: songs,
        };
    } catch (error) {
        console.error(`获取排行榜详情失败: ${error.message}`);
        throw error;
    }
}

// 获取歌词
async function getLyric(musicItem) {
    try {
        const url = "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg";
        const params = {
            songmid: musicItem.id,
            format: "json",
            nolyric: 0,
            json: 1,
        };

        const data = await httpGet(url, params);
        if (data.lyric) {
            // QQ音乐的歌词是Base64编码的
            const decoded = Buffer.from(data.lyric, 'base64').toString('utf-8');
            return {
                rawLrc: he.decode(decoded),
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

// 模块导出
module.exports = {
    platform: "QQ音乐",
    version: "1.0.0",
    author: '你的名字',
    appVersion: ">0.1.0",
    srcUrl: "你的源码URL",
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
};
