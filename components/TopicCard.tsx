import React from 'react';
import { Topic } from '../types';
import { Shield, Bot, Lock, HeartPulse, Users } from 'lucide-react';

interface TopicCardProps {
  topic: Topic;
  isSelected: boolean;
  onToggle: (id: string) => void;
}

const TopicCard: React.FC<TopicCardProps> = ({ topic, isSelected, onToggle }) => {
  const getIcon = () => {
    switch (topic.icon) {
      case 'Shield': return <Shield className="w-5 h-5" />;
      case 'Bot': return <Bot className="w-5 h-5" />;
      case 'Lock': return <Lock className="w-5 h-5" />;
      case 'HeartPulse': return <HeartPulse className="w-5 h-5" />;
      case 'Users': return <Users className="w-5 h-5" />;
      default: return <Shield className="w-5 h-5" />;
    }
  };

  return (
    <button
      onClick={() => onToggle(topic.id)}
      className={`
        flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-all duration-200
        ${isSelected
          ? 'bg-fuchsia-600 text-white shadow-md'
          : 'bg-gray-100 text-gray-700 hover:bg-fuchsia-100 hover:text-fuchsia-700'
        }
      `}
    >
      <div className={isSelected ? 'text-white' : 'text-fuchsia-600'}>
        {getIcon()}
      </div>
      <span className="font-medium text-sm">
        {topic.label}
      </span>
    </button>
  );
};

export default TopicCard;
