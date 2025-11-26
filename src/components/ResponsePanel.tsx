import React from 'react';
import { CopyIcon, CameraIcon, SettingsIcon } from './SharedComponents';

interface Header {
    key: string;
    value: string;
}

export const ResponsePanel = () => {
    const headers: Header[] = [
        { key: 'access-control-allow-origin', value: '*' },
        { key: 'content-length', value: '799' },
        { key: 'content-type', value: 'application/json; charset=utf-8' },
        { key: 'date', value: 'Sun, 23 Nov 2025 15:53:08 GMT' },
        { key: 'etag', value: 'W/"31f-ZIlYrc8xZpo70ub2M/hTxlsS914"' },
        { key: 'feature-policy', value: "payment 'self'" },
        { key: 'nel', value: '{"report_to":"heroku-nel","max_age":3600,"success_fraction":0.005,"failure_fraction":0.05,"response_headers":["Via"]}' },
        { key: 'report-to', value: '{"group":"heroku-nel","max_age":3600,"endpoints":[{"url":"https://nel.heroku.com/reports?ts=1700000000&sid=..."}]}' },
        { key: 'reporting-endpoints', value: 'heroku-nel="https://nel.heroku.com/reports?ts=1700000000&sid=..."' },
        { key: 'server', value: 'Heroku' },
        { key: 'vary', value: 'Accept-Encoding' },
        { key: 'via', value: '1.1 heroku-router' },
        { key: 'x-content-type-options', value: 'nosniff' },
        { key: 'x-frame-options', value: 'SAMEORIGIN' },
        { key: 'x-recruiting', value: '/#/jobs' },
    ];

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e] text-[#A9B7C6] font-mono text-[13px]">
            {/* Top Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#2b2b2b] bg-[#2b2b2b]">
                <div className="flex items-center gap-2 font-bold text-[#A9B7C6]">
                    <span>RESPONSE</span>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-[#1E2B24] text-[#5C996B] font-bold text-[11px] border border-[#2B4E38]">200 OK</span>
                        <span className="px-2 py-0.5 rounded bg-[#2B2B2B] text-[#A9B7C6] text-[11px] border border-[#3c3f41]">134ms</span>
                        <span className="px-2 py-0.5 rounded bg-[#2B2B2B] text-[#9876AA] text-[11px] border border-[#3c3f41]">799 Bytes</span>
                    </div>

                    <div className="h-4 w-[1px] bg-[#3c3f41]"></div>

                    <div className="flex items-center gap-3 text-[#808080]">
                        <CopyIcon className="w-4 h-4 hover:text-white cursor-pointer" />
                        <CameraIcon className="w-4 h-4 hover:text-white cursor-pointer" />
                        <SettingsIcon className="w-4 h-4 hover:text-white cursor-pointer" />
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4">

                {/* Status Line */}
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-[#9876AA] font-bold">HTTP/1.1</span>
                    <span className="text-[#6A8759] font-bold">200</span>
                    <span className="text-[#808080]">OK</span>
                </div>

                {/* Headers List */}
                <div className="flex flex-col mb-4">
                    {headers.map((header, index) => (
                        <div key={index} className="flex items-start leading-6">
                            <div className="flex-1 flex flex-wrap break-all">
                                <span className="text-[#CC7832] mr-1">{header.key}:</span>
                                <span className="text-[#A9B7C6]">{header.value}</span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Body Area */}
                <div className="mt-2 pt-2 border-t border-[#2b2b2b]">
                    <pre className="font-mono text-[13px] leading-6 outline-none bg-transparent w-full">
                        <code className="language-json">
                            <span className="text-[#A9B7C6]">{'{'}</span>
                            {'\n  '}
                            <span className="text-[#CC7832]">"authentication"</span>
                            <span className="text-[#A9B7C6]">: {'{'}</span>
                            {'\n    '}
                            <span className="text-[#CC7832]">"token"</span>
                            <span className="text-[#A9B7C6]">: </span>
                            <span className="text-[#6A8759]">"eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ..."</span>
                            {'\n  '}
                            <span className="text-[#A9B7C6]">{'}',}</span>
                            {'\n'}
                            <span className="text-[#A9B7C6]">{'}'}</span>
                        </code>
                    </pre>
                </div>
            </div>
        </div>
    );
};
