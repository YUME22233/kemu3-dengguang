/*!
 * 科目三灯光模拟考试 — 核心逻辑
 * 纯函数、无 DOM 依赖，可同时在浏览器与 Node 中运行。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LightCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* 12 个夜间场景 + “请开启前照灯”，共 13 项 */
  var SCENES = [
    {
      id: 'no-light',
      text: '夜间在没有路灯、照明不良的道路上行驶',
      type: 'high',
      op: '开启远光灯',
      short: '远光',
      tip: '照明不良时用远光看得更远；一旦会车或跟车，要立即切回近光。'
    },
    {
      id: 'follow',
      text: '夜间同方向近距离跟车行驶',
      type: 'low',
      op: '开启近光灯',
      short: '近光',
      tip: '远光会通过后视镜晃到前车司机，近距离跟车必须用近光。'
    },
    {
      id: 'narrow',
      text: '夜间在窄路、窄桥与非机动车会车',
      type: 'low',
      op: '开启近光灯',
      short: '近光',
      tip: '窄路、窄桥会车空间小，近光避免晃到对方。'
    },
    {
      id: 'meet',
      text: '夜间与机动车会车',
      type: 'low',
      op: '开启近光灯',
      short: '近光',
      tip: '距对面来车 150 米以内必须改用近光。'
    },
    {
      id: 'curve',
      text: '夜间通过急弯、坡路',
      type: 'alternate',
      op: '交替使用远近光灯',
      short: '交替',
      tip: '弯道、坡路视线受阻，交替远近光提醒对向车辆。'
    },
    {
      id: 'bridge',
      text: '夜间通过拱桥、人行横道',
      type: 'alternate',
      op: '交替使用远近光灯',
      short: '交替',
      tip: '拱桥和人行横道是视线盲区，用交替光提示行人和车辆。'
    },
    {
      id: 'crossroad',
      text: '夜间通过没有交通信号灯控制的路口',
      type: 'alternate',
      op: '交替使用远近光灯',
      short: '交替',
      tip: '无信号灯路口用交替光提示横向来车。'
    },
    {
      id: 'overtake',
      text: '夜间超越前方车辆',
      type: 'alternate',
      op: '交替使用远近光灯',
      short: '交替',
      tip: '超车前交替远近光，提醒前车你准备超车。'
    },
    {
      id: 'lit-road',
      text: '夜间在照明良好的道路上行驶',
      type: 'low',
      op: '开启近光灯',
      short: '近光',
      tip: '路灯充足时用近光，远光反而会影响其他交通参与者。'
    },
    {
      id: 'fog',
      text: '雾天行驶',
      type: 'fog',
      op: '开启雾灯和危险报警闪光灯',
      short: '雾灯+双闪',
      tip: '雾灯穿透力强，双闪提示车辆位置；不要开远光，会被雾气反射。'
    },
    {
      id: 'breakdown',
      text: '夜间在道路上发生故障，妨碍交通又难以移动',
      type: 'stop',
      op: '开启示宽灯和危险报警闪光灯',
      short: '示宽+双闪',
      tip: '难以移动时先开示宽灯和双闪提醒后方来车，并在车后放置警示牌。'
    },
    {
      id: 'park',
      text: '夜间路边临时停车',
      type: 'stop',
      op: '开启示宽灯和危险报警闪光灯',
      short: '示宽+双闪',
      tip: '临时停车应关闭大灯，开启示宽灯和双闪示意车辆位置。'
    }
  ];

  var HEADLAMP = {
    id: 'headlamp',
    text: '请开启前照灯',
    type: 'headlamp',
    op: '开启前照灯（近光）',
    short: '前照灯',
    tip: '听到指令先开启前照灯，默认使用近光。'
  };

  var TYPE_LABEL = {
    headlamp: '开启前照灯',
    high: '远光灯',
    low: '近光灯',
    alternate: '远近光交替',
    fog: '雾灯 + 双闪',
    stop: '示宽灯 + 双闪'
  };

  function initialState() {
    return { main: 0, beam: 'low', fog: false, hazard: false, flashes: 0 };
  }

  function clone(s) {
    return { main: s.main, beam: s.beam, fog: s.fog, hazard: s.hazard, flashes: s.flashes };
  }

  /* 总开关：0 关闭 / 1 示宽灯 / 2 前照灯 */
  function setMain(state, value) {
    var s = clone(state);
    var v = Math.max(0, Math.min(2, value | 0));
    s.main = v;
    if (v !== 2) {
      s.beam = 'low';
    }
    if (v === 0) {
      s.fog = false;
    }
    return s;
  }

  function setBeam(state, beam) {
    var s = clone(state);
    if (s.main !== 2) return s;
    var next = beam === 'high' ? 'high' : 'low';
    if (next !== s.beam) {
      s.beam = next;
      s.flashes += 1;
    }
    return s;
  }

  /* 模拟“拉动拨杆”一次：记一次交替，最终回到近光 */
  function flash(state) {
    var s = clone(state);
    if (s.main !== 2) return s;
    s.beam = 'low';
    s.flashes += 1;
    return s;
  }

  function toggleFog(state) {
    var s = clone(state);
    if (s.main === 0) return s;
    s.fog = !s.fog;
    return s;
  }

  function toggleHazard(state) {
    var s = clone(state);
    s.hazard = !s.hazard;
    return s;
  }

  /**
   * 判断当前灯光状态是否满足题目要求。
   * @returns {{pass:boolean, reason:string}}
   */
  function judge(question, state) {
    var s = state;
    switch (question.type) {
      case 'headlamp':
        return result(s.main === 2, s.main === 2 ? '前照灯已开启' : '前照灯未开启');
      case 'high':
        return result(
          s.main === 2 && s.beam === 'high',
          s.main !== 2 ? '前照灯未开启' : s.beam !== 'high' ? '当前不是远光灯' : ''
        );
      case 'low':
        return result(
          s.main === 2 && s.beam === 'low',
          s.main !== 2 ? '前照灯未开启' : s.beam === 'high' ? '当前是远光灯' : ''
        );
      case 'alternate':
        if (s.main !== 2) return result(false, '前照灯未开启');
        if (s.flashes < 2) return result(false, '交替次数不足');
        if (s.beam !== 'low') return result(false, '交替后未回到近光');
        return result(true, '');
      case 'fog':
        if (!s.fog) return result(false, '未开启雾灯');
        if (!s.hazard) return result(false, '未开启危险报警闪光灯');
        if (s.main === 0) return result(false, '未开启示宽灯或前照灯');
        if (s.beam === 'high') return result(false, '雾天不应使用远光');
        return result(true, '');
      case 'stop':
        if (s.main !== 1) return result(false, s.main === 2 ? '未切换到示宽灯' : '未开启示宽灯');
        if (!s.hazard) return result(false, '未开启危险报警闪光灯');
        return result(true, '');
      default:
        return result(false, '未知题目');
    }
  }

  function result(pass, reason) {
    return { pass: !!pass, reason: reason || '' };
  }

  function stateText(s) {
    var parts = [];
    if (s.main === 0) {
      parts.push('灯光关闭');
    } else if (s.main === 1) {
      parts.push('示宽灯');
    } else {
      parts.push(s.beam === 'high' ? '远光灯' : '近光灯');
    }
    if (s.fog) parts.push('雾灯');
    if (s.hazard) parts.push('双闪');
    return parts.join(' · ');
  }

  function shuffle(list, rng) {
    var a = list.slice();
    var random = rng || Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  /* 避免连续三题答案完全相同，让考试更接近真实随机 */
  function arrange(list) {
    var a = list.slice();
    for (var i = 2; i < a.length; i++) {
      if (a[i].type === a[i - 1].type && a[i].type === a[i - 2].type) {
        for (var j = i + 1; j < a.length; j++) {
          if (a[j].type !== a[i].type) {
            var t = a[i];
            a[i] = a[j];
            a[j] = t;
            break;
          }
        }
      }
    }
    return a;
  }

  /**
   * 生成一份试卷：第一题固定“请开启前照灯”，随后随机抽取场景。
   */
  function createExam(options) {
    options = options || {};
    var count = options.sceneCount == null ? 4 : options.sceneCount;
    count = Math.max(1, Math.min(SCENES.length, count | 0));
    var bank = options.pool && options.pool.length ? options.pool : SCENES;
    var picked = arrange(shuffle(bank, options.rng)).slice(0, count);
    var list = [HEADLAMP].concat(picked).map(function (q) {
      return {
        id: q.id,
        text: q.text,
        type: q.type,
        op: q.op,
        short: q.short,
        tip: q.tip
      };
    });
    return list;
  }

  function score(results) {
    var total = results.length || 1;
    var correct = results.filter(function (r) { return r.pass; }).length;
    var points = Math.round((correct / total) * 100);
    var times = results.filter(function (r) { return typeof r.elapsed === 'number' && r.elapsed > 0; })
      .map(function (r) { return r.elapsed; });
    var avg = times.length ? times.reduce(function (a, b) { return a + b; }, 0) / times.length : 0;
    return {
      total: results.length,
      correct: correct,
      wrong: results.length - correct,
      points: points,
      passed: correct === results.length,
      avgTime: avg
    };
  }

  return {
    SCENES: SCENES,
    HEADLAMP: HEADLAMP,
    TYPE_LABEL: TYPE_LABEL,
    initialState: initialState,
    setMain: setMain,
    setBeam: setBeam,
    flash: flash,
    toggleFog: toggleFog,
    toggleHazard: toggleHazard,
    judge: judge,
    stateText: stateText,
    createExam: createExam,
    score: score,
    shuffle: shuffle
  };
});
