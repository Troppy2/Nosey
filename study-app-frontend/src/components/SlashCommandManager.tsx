import useeffect from "react";
import { SlashCommandMenu, type SlashCommand } from "../components/SlashCommandMenu";
import { MessageCircle, RotateCcw, Trash2 } from "lucide-react";

interface SlashCommandManagerProps {
    command?: string;
}
    
const CHAT_COMMANDS: SlashCommand[] = [

];