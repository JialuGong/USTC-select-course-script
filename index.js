const superagent = require("superagent");
const fs = require('fs');
const nodemailer = require("nodemailer");

const userAgent = "USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36'";
const pageUrl = "https://jw.ustc.edu.cn/for-std/course-select/352169/turn/481/select";
const addLessonUrl = 'https://jw.ustc.edu.cn/ws/for-std/course-select/add-request';
const addableUrl = 'https://jw.ustc.edu.cn/ws/for-std/course-select/addable-lessons';
const stdCountUrl = 'https://jw.ustc.edu.cn/ws/for-std/course-select/std-count';
const resultQueryUrl = 'https://jw.ustc.edu.cn/ws/for-std/course-select/add-drop-response';

/**dreacourse的id数组，如何获取id，详见readme */
const courseIDList = [137509];
/**每隔多长时间选一次课，单位ms */
const intervalTime = 5 * 1000;


/**
 * 读取配置
 */
const cookiePromise = new Promise((res, rej) => {
    fs.readFile('./config.json', (err, data) => {
        if (err) rej(err);
        else res(data)
    })
});

/**
 * 邮件提醒选课成功
 */
const emailNotify = async (host, emailAddr, password, courseNam) => {
    const transporter = nodemailer.createTransport({
        host: host,
        port: 465,
        auth: {
            user: emailAddr,
            pass: password
        }
    });

    await transporter.sendMail({
        from: emailAddr,
        to: emailAddr,
        subject: 'Course Selecting Notify',
        html: `<h1>have choosed ${courseNam} !!! </h1>`
    });
}



(async () => {
    try {
        const cookieRes = await cookiePromise;
        const { SESSION, SVRNAME, host, emailAddr, password } = JSON.parse(cookieRes);
        const cookieCotent = `SESSION=${SESSION}; SVRNAME=${SVRNAME}`;
        /**获取studentId和turenId */
        const res = await superagent.get(pageUrl).set("cookie", cookieCotent).set("User-Agent", userAgent);
        const studentId = /(?<=studentId: )[0-9]+/.exec(res.text)[0];
        const turnId = /(?<=turnId: )[0-9]+/.exec(res.text)[0];
        const addableLesson = await superagent.post(addableUrl).set("cookie", cookieCotent)
            .set("User-Agent", userAgent)
            .set('Content-Type', 'multipart/form-data')
            .field('studentId', studentId)
            .field('turnId', turnId);

        /**获取dream course的课容量 */
        const courseCoutHash =await addableLesson.body.
            filter(item => courseIDList.includes(item.id)).
            reduce((acc, item) => acc.set(item.id, item.limitCount), new Map());


        /**每隔n ms查询当前人数，如果可选则进行选课 */
        const myInterval = setInterval(async () => {
            //轮询现在有多少人
            try {
                if (courseIDList.filter(x => x !== 0).length === 0) clearInterval(myInterval);
                const stdRes = await courseIDList
                    .filter(x => x !== 0).reduce((acc, id) => acc.field("lessonIds[]", id),
                        superagent.post(stdCountUrl)
                            .set("cookie", cookieCotent)
                            .set("User-Agent", userAgent)
                            .set('Content-Type', 'multipart/form-data'))

                const courseState = stdRes.body;
                courseIDList.filter(x => x !== 0).forEach(async (id, index) => {
                    console.log({ limit: courseCoutHash.get(id), count: courseState[id] })
                    if (courseCoutHash.get(id) > courseState[id]) {
                        console.log(`恭喜！${id}是可选课程`)
                        //是可选的，进行选课
                        const addRes = await superagent.post(addLessonUrl)
                            .set("cookie", cookieCotent)
                            .set("User-Agent", userAgent)
                            .set('Content-Type', 'multipart/form-data')
                            .field('studentAssoc', studentId)
                            .field('lessonAssoc', id)
                            .field('courseSelectTurnAssoc', turnId)
                            .field('scheduleGroupAssoc', '')
                            .field('virtualCost', 0);
                        //查询选课结果
                        const queryRes = await superagent.post(resultQueryUrl)
                            .set("cookie", cookieCotent)
                            .set("User-Agent", userAgent)
                            .set('Content-Type', 'multipart/form-data')
                            .field('studentId', studentId)
                            .field('requestId', addRes.text);
                        const { success } = queryRes.body;
                        if (success) {
                            console.log(`${id}选课成功!`)
                            await emailNotify(host, emailAddr, password, id);
                            //id置为0表示已经选中
                            courseIDList[index] = 0;
                        }
                    } else {
                        console.log(`${id}已经满了`)
                    }
                })
            } catch (err) {
                console.log(err);
            }
        }, intervalTime);
    } catch (err) {
        console.log(err);
    }
})();

