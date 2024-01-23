import { ThemeDocument } from "@/prismicio-types";
import { PrismicNextImage } from "@prismicio/next";
import React from "react";

const Header = ({ theme }: { theme: ThemeDocument }) => {
    const mainColor = theme?.data.main_color
    return (
        <header className="bg-[#ffffff] px-[84px] py-[16px] shadow-sm border-b">
            <div className="max-w-screen-xl mx-auto flex items-center justify-between">
                {/* Logo */}
                <div className="flex items-center justify-start">
                    <PrismicNextImage field={theme?.data.logo} className="h-[96px] w-auto object-contain" />
                </div>
                {/* Navigation */}
                <nav className="hidden md:flex items-center space-x-[48px] font-sans"
                    style={{ color: mainColor ? mainColor : "#171717" }}
                >
                    <a href="#features" className="hover:text-[#487b94] transition-colors duration-300">
                        Features
                    </a>
                    <a href="#pricing" className="hover:text-[#487b94] transition-colors duration-300">
                        Pricing
                    </a>
                    <a href="#about" className="hover:text-[#487b94] transition-colors duration-300">
                        About
                    </a>
                    <a href="#contact" className="hover:text-[#487b94] transition-colors duration-300">
                        Contact
                    </a>
                </nav>
                {/* Mobile menu button */}
                <div className="md:hidden flex items-center">
                    <button className="text-[#171717] p-[12px] rounded-[8px] bg-white">
                        Menu
                    </button>
                </div>
            </div>
        </header>
    );
};

export default Header;