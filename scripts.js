class VideoBlock {
    constructor(url, title, author, comments, likes, callbacker) {
        this.url = url;
        this.title = title;
        this.author = author;
        this.comments = comments;
        this.likes = likes;
        this.callbacker = callbacker;

        this._video = null;
        this._canvas = null;
        this._canvasCtx = null;
        this._wrapper = null;

        this._canvasVideoSync = (function() {
            if (this._canvasCtx && this._video && this._canvas) {
                if (this._canvas.width !== this._video.videoWidth) {
                    this._canvas.width = this._video.videoWidth ;
                    this._canvas.height = this._video.videoHeight;
                }
                this._canvasCtx.drawImage(this._video, 0, 0, this._canvas.width, this._canvas.height);
                if (this._video.paused || this._video.ended) return;
                requestAnimationFrame(this._canvasVideoSync);
            }
        }).bind(this);
    }

    mount(wrapper) {
        this._wrapper = wrapper;
        this._canvas = document.createElement('canvas');
        this._canvas.classList.add('canvas');
        this._canvasCtx = this._canvas.getContext('2d');
        this._wrapper.appendChild(this._canvas);


        this._video = document.createElement('video');
        this._video.classList.add('video');
        this._wrapper.appendChild(this._video);

        this._video.preload = 'auto';
        this._video.loop = true;
        this._video.src = 'videos/' + this.url;

        this._video.addEventListener('click', () => {
            if (this._video.paused || this._video.ended) {
                this._video.play().then(() => this.callbacker.playCallback('play'));
            } else {
                this._video.pause();
                this.callbacker.playCallback('stop');
            }
        })

        this._video.addEventListener('play', this._canvasVideoSync);
        this._video.addEventListener('loadeddata', this._canvasVideoSync);

        const layout = document.createElement('div');
        layout.classList.add('info-layout')
        this._renderInfo(layout);
        this._wrapper.appendChild(layout);
    }

    _renderInfo(node) {
        const bottom = document.createElement('div');
        bottom.classList.add('bottom');
        bottom.innerHTML = `<div class="title text-stroked">${this.title}</div><div class="author text-stroked">${this.author}</div>`;

        const right = document.createElement('div');
        right.classList.add('right');
        right.innerHTML = `<div class="comments ">${formatedNumber(this.comments)}</div><div class="likes">${formatedNumber(this.likes)}</div>`;

        node.appendChild(bottom);
        node.appendChild(right);
    }

    isMounted() {
        return this._video && this._canvas;
    }

    reMount() {
        this.mount(this._wrapper);
    }

    unmount() {
        if (this._video && this._canvas) {
            this._video.pause();
            this._video = null;
            this._canvas = null;
            this._canvasCtx = null;
            while (this._wrapper.firstChild) {
                this._wrapper.removeChild(this._wrapper.lastChild);
            }
        }
    }

    stopVideo() {
        if (this._video) {
            this._video.pause();
            this._video.currentTime = 0;
        }
    }

    playVideo() {
        if (this._video) {
            return this._video.play();
        }
        return Promise.reject(new Error("No video"));
    }
}



class DoomScroll {
    _items = [];
    _currentIndex = 0;
    _node = null;

    _checkForUnmountAllow = true;
    _autoLoadDistance = 3;
    _autoUnMountDistance = 10;
    _fetchSize = 5;
    _fetchLock = false;
    _unmountCandidates = {};

    constructor(placeNode, fetchSize, autoloadDistance, autoUnMoundDistance) {
        this._autoLoadDistance = autoloadDistance;
        this._autoUnMountDistance = autoUnMoundDistance;
        this._fetchSize = fetchSize;

        this._node = placeNode;

        this._node.addEventListener('scrollsnapchanging', (scrolledElement) => {
            this.playCallback('scroll');

            const nearIndex = Number.parseInt(scrolledElement.snapTargetBlock.dataset.index);
            const min = Math.max(0, nearIndex - this._autoUnMountDistance);
            const max = Math.min(nearIndex + this._autoUnMountDistance, this._items.length - 1);

            for (let idx = min; idx <= max; idx++) {
                if (!this._items[idx].isMounted()) {
                    this._items[idx].reMount();
                    this._unmountCandidates[idx] = idx;
                }
            }
        })

        this._node.addEventListener('scrollsnapchange', (newSelectedElement) => {
            // Старый блок
            this._items[this._currentIndex].stopVideo();

            // Новый блок
            this._currentIndex = Number.parseInt(newSelectedElement.snapTargetBlock.dataset.index);
            this._items[this._currentIndex].playVideo().then(() => {
                this.playCallback('play');
            }).catch(() => {
                this.playCallback('stop');
            });

            if (this._items.length - this._currentIndex < this._autoLoadDistance && !this._fetchLock) {
                this._fetchLock = true;
                this.loadNext(this._fetchSize).finally(() => this._fetchLock = false);
            }

            //Всегда
            if (this._checkForUnmountAllow && this._items.length > 2 * this._autoUnMountDistance && Object.keys(this._unmountCandidates).length > 0) {
                this._checkForUnmountAllow = false;
                const candidates = Object.keys(this._unmountCandidates);
                for (let candidateIndex of candidates) {
                    const index = Number.parseInt(candidateIndex);
                    if (Math.abs(this._currentIndex - index) > this._autoUnMountDistance) {
                        this._items[index].unmount();
                        delete(this._unmountCandidates[candidateIndex]);
                    }
                }
                setTimeout(() => this._checkForUnmountAllow = true, 10000);
            }
        })


        this.loadNext(2).then();
    }

    playCallback(state) {
        if (state === 'play' || state === 'scroll') {
            this._node.classList.remove('stopped');
        } else if (state === 'stop') {
            this._node.classList.add('stopped');
        }
    }

    async loadNext(count) {
        const videos = await apiFetchNext(count);
        for (let video of videos) {
            const wrapper = document.createElement('div');
            wrapper.classList.add('video-wrapper');

            const videoBlock = new VideoBlock(video.url, video.title, video.author, video.comments, video.likes, this);
            const blockIndex = this._items.push(videoBlock) - 1
            wrapper.dataset.index = String(blockIndex);

            videoBlock.mount(wrapper);
            this._unmountCandidates[blockIndex] = blockIndex;
            this._node.appendChild(wrapper);
        }
    }
}

function formatedNumber(number) {
    if (number / 1000000 >= 1) {
        return Math.floor(number / 1000000) + 'kk';
    }
    if (number / 1000 >= 1) {
        return Math.floor(number / 1000) + 'k';
    }

    return number;
}

let prevVideoId = -1;
async function apiFetchNext(count) {
    await new Promise((s) => {
        setTimeout(s, Math.random() * 2000 + Math.random() * 500 * count);
    })

    const result = [];

    for (let i = 0; i < count; i++) {
        do {
            const videoId = Math.floor(Math.random() * videoList.length);
            if (videoId === prevVideoId) {
                continue;
            }
            prevVideoId = videoId
            result.push({
                url: videoList[prevVideoId],
                likes: Math.floor(Math.random() * 100000),
                comments: Math.floor(Math.random() * 100),
                author: authorList[Math.floor(Math.random() * authorList.length)],
                title: titleList[Math.floor(Math.random() * titleList.length)],
            });
        } while (false);
    }

    return result;
}


const videoList = [
    '-1381854028232193089.MP4',  '-6974447037748169156.MP4',  '6737137111559968548.MP4',
    '-2466797579047759691.MP4',  '3698940505591559678.MP4',   '7578542087815133230.MP4',
    '-2635594312504430960.MP4',  '3746059563046546718.MP4',   '7870372071727092435.MP4',
    '-425148686832983381.MP4',   '6702137189532704568.MP4',
];

const authorList = [
    "urban_mike",
    "lena.wave",
    "maxon_77",
    "kate_north",
    "denis.gray",
    "little_fox23",
    "alex.morning",
    "nika_sky",
    "roman_vibe",
    "annie_lime",
    "serg.outside",
    "mila_roze",
    "timur.one",
    "polly_day",
    "kirill_nov",
    "sunny_ira",
    "vadim.space",
    "nastya_rain",
    "artem_neo",
    "vera.moon"
];

const titleList = [
    'Вот это видео',
    'Утро, которое пошло не по плану',
    'Прогулка по вечернему городу',
    'Что осталось за кадром',
    'Один обычный день',
    'Проверяем странные лайфхаки',
    'Поездка без маршрута',
    'Неожиданная находка',
    'Как это выглядит на самом деле',
    'Небольшое путешествие на выходных',
    'Лучшие моменты этой недели',
    'Просто красивый закат',
    'Решили попробовать впервые',
    'День за две минуты',
    'Что будет, если сделать наоборот',
    'История одной фотографии',
    'Дождливый вечер',
    'Тестируем новую идею',
    'Случайное видео из поездки',
    'Вид сверху оказался лучше',
    'Нашли интересное место',
    'Всё пошло совсем не так',
    'Несколько кадров на память',
    'Ночная прогулка',
    'До и после',
    'Место, куда хочется вернуться',
    'Эксперимент на один день',
    'Когда решил снять всего минуту',
    'Маленькое приключение',
    'Просто хороший день',
    'Последние минуты лета',
];


document.addEventListener("DOMContentLoaded", () => {
    const node = document.getElementById("doom-scroller");
    if (node) {
        new DoomScroll(node, 6, 5, 10);
    }
})


