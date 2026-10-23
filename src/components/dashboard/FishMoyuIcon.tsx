import { motion } from 'framer-motion';

interface FishMoyuIconProps {
    level?: 'sprint' | 'smooth' | 'tea' | 'slack' | 'idle';
    className?: string;
    isMoving?: boolean;
}

export function FishMoyuIcon({ level = 'smooth', className = 'w-6 h-6', isMoving = true }: FishMoyuIconProps) {
    const isWork = level === 'sprint' || level === 'smooth';

    if (isWork) {
        // ========== 1. 疯狂工作小鱼 (系奋斗头带 · 戴极客护目镜 · 尾巴喷火疾速冲刺) ==========
        return (
            <div className={`relative inline-flex items-center justify-center shrink-0 ${className}`} title="算力全开 · 疯狂工作冲刺中">
                <motion.div
                    className="w-full h-full"
                    animate={isMoving ? { y: [-0.6, 0.6, -0.6], x: [0, 0.8, 0] } : {}}
                    transition={{ duration: 0.25, repeat: Infinity, ease: 'linear' }}
                >
                    <svg viewBox="0 0 34 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full overflow-visible">
                        <defs>
                            <linearGradient id="workBodyGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#059669" />
                                <stop offset="100%" stopColor="#10b981" />
                            </linearGradient>
                            <linearGradient id="rocketFlame" x1="100%" y1="50%" x2="0%" y2="50%">
                                <stop offset="0%" stopColor="#ef4444" />
                                <stop offset="60%" stopColor="#f97316" />
                                <stop offset="100%" stopColor="#facc15" />
                            </linearGradient>
                            <linearGradient id="goggleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="#38bdf8" />
                                <stop offset="100%" stopColor="#06b6d4" />
                            </linearGradient>
                        </defs>

                        {/* 尾部疾速火箭推进尾焰 (疯狂冲刺动效) */}
                        <motion.path
                            d="M6 12L-3 9.5L-1 12L-3 14.5Z"
                            fill="url(#rocketFlame)"
                            animate={isMoving ? { scaleX: [0.7, 1.4, 0.7], opacity: [0.7, 1, 0.7] } : {}}
                            transition={{ duration: 0.18, repeat: Infinity, ease: 'easeInOut' }}
                            style={{ transformOrigin: '6px 12px' }}
                        />

                        {/* 高频摇摆的强力尾翼 */}
                        <motion.g
                            style={{ transformOrigin: '7px 12px' }}
                            animate={isMoving ? { rotate: [-18, 18, -18] } : {}}
                            transition={{ duration: 0.22, repeat: Infinity, ease: 'easeInOut' }}
                        >
                            <path d="M7 12L1.5 6L3.5 12L1.5 18L7 12Z" fill="#047857" />
                        </motion.g>

                        {/* 前冲俯冲鱼身 */}
                        <path
                            d="M6 12C9 6.5 20 5.5 28 12C20 18.5 9 17.5 6 12Z"
                            fill="url(#workBodyGrad)"
                        />

                        {/* 迎风飞扬的红色“奋斗必胜”头巾飘带 */}
                        <motion.path
                            d="M19 6.5C16 5 13 4 10 4.5C12 6 15 7 18 7.5Z"
                            fill="#ef4444"
                            animate={isMoving ? { rotate: [-10, 10, -10] } : {}}
                            transition={{ duration: 0.3, repeat: Infinity, ease: 'easeInOut' }}
                            style={{ transformOrigin: '19px 6.5px' }}
                        />
                        <path d="M19 6C22 5.5 25 6 27 7.5C26 8 23 7.5 19 7Z" fill="#dc2626" />

                        {/* 上背鳍 (低阻力战斗机翼型) */}
                        <path d="M14 7L18 3.5L20 6.5Z" fill="#047857" />

                        {/* 疯狂敲代码的机械胸鳍 (超高频摆动) */}
                        <motion.path
                            d="M17 14L22 17L18 17.5Z"
                            fill="#047857"
                            animate={isMoving ? { rotate: [-15, 20, -15] } : {}}
                            transition={{ duration: 0.16, repeat: Infinity, ease: 'easeInOut' }}
                            style={{ transformOrigin: '17px 14px' }}
                        />

                        {/* 极客发光护目镜 (Cyber Goggles) */}
                        <rect x="22" y="9" width="6.5" height="4.5" rx="1.5" fill="#0f172a" stroke="#22d3ee" strokeWidth="0.8" />
                        <rect x="23" y="10" width="4.5" height="2.5" rx="0.8" fill="url(#goggleGrad)" />
                        {/* 镜片反光 */}
                        <line x1="23.5" y1="10.5" x2="25.5" y2="12" stroke="#ffffff" strokeWidth="0.6" strokeLinecap="round" opacity="0.9" />

                        {/* 疾速飞驰产生的破空流线 */}
                        <motion.line
                            x1="30"
                            y1="8"
                            x2="33"
                            y2="8"
                            stroke="#34d399"
                            strokeWidth="0.8"
                            strokeLinecap="round"
                            animate={isMoving ? { x: [-1, 2, -1], opacity: [0.3, 0.9, 0.3] } : {}}
                            transition={{ duration: 0.25, repeat: Infinity }}
                        />
                        <motion.line
                            x1="29"
                            y1="16"
                            x2="32"
                            y2="16"
                            stroke="#34d399"
                            strokeWidth="0.8"
                            strokeLinecap="round"
                            animate={isMoving ? { x: [-1, 2, -1], opacity: [0.2, 0.8, 0.2] } : {}}
                            transition={{ duration: 0.22, repeat: Infinity, delay: 0.1 }}
                        />
                    </svg>
                </motion.div>
            </div>
        );
    }

    // ========== 2. 悠闲摸鱼小鱼 (戴酷炫墨镜 · 仰躺浮水 · 慢悠悠吐泡泡) ==========
    return (
        <div className={`relative inline-flex items-center justify-center shrink-0 ${className}`} title="悠闲摸鱼 · 待机放松中">
            <motion.div
                className="w-full h-full"
                animate={isMoving ? { y: [-1.2, 1.2, -1.2], rotate: [-2, 2, -2] } : {}}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            >
                <svg viewBox="0 0 34 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full overflow-visible">
                    <defs>
                        <linearGradient id="slackBodyGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#fb7185" />
                            <stop offset="100%" stopColor="#f43f5e" />
                        </linearGradient>
                    </defs>

                    {/* 悠闲慢飘大泡泡 */}
                    <motion.circle
                        cx="30"
                        cy="7"
                        r="1.6"
                        fill="#fecdd3"
                        stroke="#f43f5e"
                        strokeWidth="0.6"
                        animate={isMoving ? { y: [0, -5, 0], opacity: [0.3, 0.9, 0.3], scale: [0.8, 1.2, 0.8] } : {}}
                        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    {/* 小泡泡 */}
                    <motion.circle
                        cx="32.5"
                        cy="3.5"
                        r="1.0"
                        fill="#ffe4e6"
                        stroke="#fb7185"
                        strokeWidth="0.5"
                        animate={isMoving ? { y: [0, -6, 0], opacity: [0.2, 0.8, 0.2] } : {}}
                        transition={{ duration: 3.0, repeat: Infinity, delay: 0.6, ease: 'easeInOut' }}
                    />
                    {/* 惬意的 Zzz 睡眠/摸鱼小气泡 */}
                    <motion.text
                        x="31"
                        y="1"
                        fontSize="4"
                        fontWeight="bold"
                        fill="#fb7185"
                        opacity="0.8"
                        animate={isMoving ? { y: [0, -3, 0], opacity: [0, 0.9, 0] } : {}}
                        transition={{ duration: 2.8, repeat: Infinity, delay: 0.3 }}
                    >
                        z
                    </motion.text>

                    {/* 慢节奏悠闲晃荡的小尾巴 */}
                    <motion.g
                        style={{ transformOrigin: '7px 12px' }}
                        animate={isMoving ? { rotate: [-10, 10, -10] } : {}}
                        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                    >
                        <path d="M7 12L1.5 6.5C3.5 10 3.5 14 1.5 17.5L7 12Z" fill="#e11d48" />
                    </motion.g>

                    {/* 胖乎乎仰躺松弛的咸鱼体态 */}
                    <path
                        d="M6 12C9 7 20 6.5 27 12C20 18 9 17.5 6 12Z"
                        fill="url(#slackBodyGrad)"
                    />

                    {/* 懒洋洋的背鳍 */}
                    <path d="M13 7.5C15 4.5 19 5.5 21 7.5Z" fill="#e11d48" opacity="0.85" />
                    {/* 腹鳍 */}
                    <path d="M15 16.5C17 19 20 18 21 16.5Z" fill="#e11d48" opacity="0.85" />

                    {/* 超酷黑色太阳度假墨镜 (Cool Sunglasses) */}
                    <rect x="22" y="9" width="6.5" height="4.5" rx="1.2" fill="#0f172a" stroke="#334155" strokeWidth="0.6" />
                    {/* 墨镜镜腿 */}
                    <path d="M22 10.5H19.5" stroke="#0f172a" strokeWidth="0.8" strokeLinecap="round" />
                    {/* 墨镜帅气白色反光条纹 */}
                    <line x1="23.5" y1="10" x2="25" y2="12.5" stroke="#ffffff" strokeWidth="0.7" strokeLinecap="round" opacity="0.9" />
                    <line x1="26" y1="10.5" x2="27" y2="12" stroke="#ffffff" strokeWidth="0.5" strokeLinecap="round" opacity="0.6" />

                    {/* 悠闲惬意的大微笑嘴 */}
                    <path
                        d="M26.5 14C26 14.8 25 14.8 24.5 14.2"
                        stroke="#9f1239"
                        strokeWidth="0.9"
                        strokeLinecap="round"
                    />
                </svg>
            </motion.div>
        </div>
    );
}
