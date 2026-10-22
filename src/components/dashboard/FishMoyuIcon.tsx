import { motion } from 'framer-motion';

interface FishMoyuIconProps {
    level?: 'sprint' | 'smooth' | 'tea' | 'slack' | 'idle';
    className?: string;
    isMoving?: boolean;
}

export function FishMoyuIcon({ level = 'smooth', className = 'w-6 h-6', isMoving = true }: FishMoyuIconProps) {
    const getColor = () => {
        switch (level) {
            case 'sprint':
                return { body: '#10b981', fin: '#059669', bubble: '#34d399' };
            case 'smooth':
                return { body: '#3b82f6', fin: '#2563eb', bubble: '#60a5fa' };
            case 'tea':
                return { body: '#f59e0b', fin: '#d97706', bubble: '#fbbf24' };
            case 'slack':
            default:
                return { body: '#f43f5e', fin: '#e11d48', bubble: '#fb7185' };
        }
    };

    const colors = getColor();

    return (
        <div className={`relative inline-flex items-center justify-center shrink-0 ${className}`}>
            <svg
                viewBox="0 0 32 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="w-full h-full overflow-visible"
            >
                {/* 漂浮的小水泡 (悠闲吐泡泡动效) */}
                <motion.circle
                    cx="29"
                    cy="8"
                    r="1.2"
                    fill={colors.bubble}
                    animate={isMoving ? { y: [-1, -4, -1], opacity: [0.2, 0.9, 0.2], scale: [0.8, 1.2, 0.8] } : {}}
                    transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                />
                <motion.circle
                    cx="31"
                    cy="5"
                    r="0.8"
                    fill={colors.bubble}
                    animate={isMoving ? { y: [-1, -5, -1], opacity: [0.1, 0.8, 0.1] } : {}}
                    transition={{ duration: 2.2, repeat: Infinity, delay: 0.4, ease: 'easeInOut' }}
                />

                {/* 鱼身主体 (流线型小胖鱼) */}
                <motion.path
                    d="M6 12C9 7 20 6 27 12C20 18 9 17 6 12Z"
                    fill={colors.body}
                    animate={isMoving ? { scaleY: [1, 1.05, 1] } : {}}
                    transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                />

                {/* 上背鳍 */}
                <path
                    d="M13 7.5C15 4 19 5 21 7.2C18 7.5 15 7.5 13 7.5Z"
                    fill={colors.fin}
                    opacity="0.85"
                />

                {/* 腹鳍 */}
                <path
                    d="M15 16.5C17 19 20 18.5 21 16.8C18.5 16.5 16.5 16.5 15 16.5Z"
                    fill={colors.fin}
                    opacity="0.85"
                />

                {/* 动态摇摆鱼尾巴 (Framer Motion 真实摆动，真正能摇尾巴的小鱼！) */}
                <motion.g
                    style={{ transformOrigin: '7px 12px' }}
                    animate={isMoving ? { rotate: [-14, 14, -14] } : {}}
                    transition={{ duration: level === 'sprint' ? 0.4 : 1.2, repeat: Infinity, ease: 'easeInOut' }}
                >
                    <path
                        d="M7 12L1.5 6.5C3.5 10 3.5 14 1.5 17.5L7 12Z"
                        fill={colors.fin}
                    />
                </motion.g>

                {/* 呆萌鱼眼 */}
                <circle cx="23.5" cy="10.5" r="1.6" fill="#ffffff" />
                <circle cx="24.2" cy="10.3" r="0.9" fill="#0f172a" />
                {/* 眼睛高光 */}
                <circle cx="24.5" cy="10" r="0.35" fill="#ffffff" />

                {/* 微微微笑的小鱼嘴 */}
                <path
                    d="M26.5 13C26 13.5 25.2 13.5 25 13.2"
                    stroke={colors.fin}
                    strokeWidth="0.75"
                    strokeLinecap="round"
                />
            </svg>
        </div>
    );
}
