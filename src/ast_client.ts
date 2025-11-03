import WebSocket from 'ws';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// 从环境变量读取WebSocket URL，支持以下方式：
// 1. WS_URL - 完整的WebSocket URL
// 2. WS_HOST + WS_PORT - 分别指定host和port（默认路径为 /tuling/ast/v3）
// 默认值保持向后兼容
const WS_URL = process.env.WS_URL || 
    `ws://${process.env.WS_HOST || '172.16.18.16'}:${process.env.WS_PORT || '8857'}/tuling/ast/v3`;
console.log(`WebSocket URL: ${WS_URL}`);
const AUDIO_PATH = 'data/zhangsanfeng.wav';
const FRAME_SIZE = 4096;
const INTERVAL = 40; // ms

function genTraceId(): string {
    return uuidv4();
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendAudio(ws: WebSocket, audioPath: string): Promise<void> {
    try {
        const traceId = genTraceId();
        const bizId = 'test_bizid_001';
        const appId = '123456';
        let status = 0;

        if (!fs.existsSync(audioPath)) {
            throw new Error(`音频文件不存在: ${audioPath}`);
        }

        const fileBuffer = fs.readFileSync(audioPath);
        let offset = 0;
        let isFirstChunk = true;
        let chunkNumber = 0;

        while (offset < fileBuffer.length) {
            chunkNumber++;
            const chunk = fileBuffer.slice(offset, offset + FRAME_SIZE);
            offset += FRAME_SIZE;

            // 判断是否为最后一块
            const isLastChunk = offset >= fileBuffer.length;
            if (isLastChunk) {
                status = 2;
            }

            const audioB64 = chunk.toString('base64');
            const payload: Record<string, unknown> = {
                audio: {
                    audio: audioB64,
                },
            };

            // if (isFirstChunk) {
            //   payload.text = {
            //     // text: Array.from({length: 2000}, (_, i) => `热词${i + 1}`).join('|'),
            //     text: "张三疯|向钱看"
            //   };
            // }

            const msg = {
                header: {
                    traceId,
                    appId,
                    bizId,
                    status,
                    resIdList: [] as string[],
                },
                parameter: {
                    engine: {
                        wdec_param_LanguageTypeChoice: '1',
                    },
                },
                payload,
            };

            try {
                ws.send(JSON.stringify(msg));
                // ws.send("1")
            } catch (sendError) {
                console.error(`发送第${chunkNumber}块时出错:`, sendError);
                throw sendError;
            }

            if (isLastChunk) {
                break;
            }

            await sleep(INTERVAL);
            status = 1;
            isFirstChunk = false;
        }
    } catch (error) {
        console.error('发送音频过程中出错:', error);
        throw error;
    }
}

async function receiveResult(ws: WebSocket, audioPath: string): Promise<void> {
    const startTime = Date.now();
    return new Promise((resolve) => {
        let results: Array<{ sequence: number; data: any }> = [];
        let sequenceNumber = 1;
        let accumulatedText = '';
        let role = "角色0";

        ws.on('message', (data: WebSocket.RawData) => {
            try {
                const now = Date.now();
                const elapsed = now - startTime;
                console.log(`[${audioPath}]: 收到第${sequenceNumber}条消息，耗时${elapsed}ms`);

                const message = data.toString();
                const resp = JSON.parse(message);

                const resultWithSequence = {
                    sequence: sequenceNumber,
                    data: resp,
                };
                results.push(resultWithSequence);

                // 解析识别结果
                if (resp.payload && resp.payload.result) {
                    const result = resp.payload.result;
                    const bg = result.bg;
                    const ed = result.ed;
                    const msgtype = result.msgtype || '';
                    let currentText = '';

                    if (result.ws) {
                        for (const wsItem of result.ws) {
                            if (wsItem.cw) {
                                for (const cwItem of wsItem.cw) {
                                    if (cwItem.w) {
                                        currentText += cwItem.w;
                                        if (cwItem.rl == 1) {
                                            role = "角色1";
                                        } else if (cwItem.rl == 2) {
                                            role = "角色2";
                                        }
                                        currentText += `(${role})`;
                                    }
                                }
                            }
                        }
                    }

                    currentText += `[时间：${bg}~${ed}]`;

                    let statusLabel = '';
                    let displayText = '';
                    if (msgtype === 'progressive') {
                        statusLabel = '【中间状态】';
                        displayText = accumulatedText + currentText;
                    } else if (msgtype === 'sentence') {
                        accumulatedText += currentText;
                        statusLabel = '【最终状态】';
                        displayText = accumulatedText;
                    } else {
                        statusLabel = '【未知状态】';
                        displayText = accumulatedText + currentText;
                    }

                    console.log(`#${sequenceNumber}: ${statusLabel} ${displayText}`);
                }

                // 判断是否结束
                if (resp.header && resp.header.status === 2) {
                    console.log(`[${audioPath}]: ${accumulatedText}`);

                    // 保存结果到JSON文件
                    try {
                        const outputData = {
                            audioPath: audioPath,
                            totalResults: results.length,
                            accumulatedText: accumulatedText,
                            results: results,
                        };

                        // 生成带时间戳的文件名
                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                        const fileName = `results_${timestamp}.json`;
                        const outputPath = `output/${fileName}`;

                        // 确保输出目录存在
                        if (!fs.existsSync('output')) {
                            fs.mkdirSync('output', { recursive: true });
                        }

                        // 写入JSON文件
                        fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf8');
                        console.log(`结果已保存到: ${outputPath}`);
                    } catch (saveError) {
                        console.error('保存结果到JSON文件失败:', saveError);
                    }

                    ws.close();
                    resolve();
                }

                sequenceNumber++;
            } catch (e) {
                console.error('解析服务端消息失败:', e);
            }
        });

        ws.on('error', (err) => {
            console.error('WebSocket错误:', err);

            // 即使出错也保存已收到的结果
            if (results.length > 0) {
                try {
                    const outputData = {
                        audioPath: audioPath,
                        totalResults: results.length,
                        error: 'WebSocket连接出错',
                        results: results,
                    };

                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const fileName = `results_error_${timestamp}.json`;
                    const outputPath = `output/${fileName}`;

                    if (!fs.existsSync('output')) {
                        fs.mkdirSync('output', { recursive: true });
                    }

                    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf8');
                    console.log(`错误结果已保存到: ${outputPath}`);
                } catch (saveError) {
                    console.error('保存错误结果失败:', saveError);
                }
            }

            ws.close();
            resolve();
        });

        ws.on('close', () => {
            // 连接关闭时也保存结果
            if (results.length > 0) {
                try {
                    const outputData = {
                        audioPath: audioPath,
                        totalResults: results.length,
                        status: '连接关闭',
                        results: results,
                    };

                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const fileName = `results_closed_${timestamp}.json`;
                    const outputPath = `output/${fileName}`;

                    if (!fs.existsSync('output')) {
                        fs.mkdirSync('output', { recursive: true });
                    }

                    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf8');
                    console.log(`连接关闭结果已保存到: ${outputPath}`);
                } catch (saveError) {
                    console.error('保存连接关闭结果失败:', saveError);
                }
            }

            resolve();
        });
    });
}

async function main(): Promise<void> {
    try {
        const ws = new WebSocket(WS_URL);

        const connectionTimeout = setTimeout(() => {
            console.error('WebSocket连接超时');
            ws.terminate();
        }, 10000);

        ws.on('open', async () => {
            clearTimeout(connectionTimeout);
            try {
                await Promise.all([
                    sendAudio(ws, AUDIO_PATH),
                    receiveResult(ws, AUDIO_PATH),
                ]);
            } catch (error) {
                console.error('处理音频时出错:', error);
            }
        });

        ws.on('error', (error: Error & { message?: string }) => {
            clearTimeout(connectionTimeout);
            console.error('WebSocket连接错误:', error.message);
        });

        ws.on('close', () => {
            clearTimeout(connectionTimeout);
        });

        ws.on('unexpected-response', (request: unknown, response: any) => {
            clearTimeout(connectionTimeout);
            console.error(`WebSocket连接失败: HTTP ${response.statusCode} ${response.statusMessage}`);
        });
    } catch (error) {
        console.error('创建WebSocket连接时出错:', error);
    }
}

main().catch((err) => {
    console.error('程序异常:', err);
});


