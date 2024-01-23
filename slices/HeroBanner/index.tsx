import { PrismicNextImage, PrismicNextLink } from "@prismicio/next"
import { PrismicRichText, SliceComponentProps } from "@prismicio/react"
import { Content } from "@prismicio/client";
import { ThemeDocument } from "@/prismicio-types";

/**
 * Props for `HeroBanner`.
 */
export type HeroBannerProps = SliceComponentProps<Content.HeroBannerSlice, SliceZoneContext>;

type SliceZoneContext = {
  theme: ThemeDocument
};

/**
 * Component for "HeroBanner" Slices.
 */
const HeroBanner = ({ slice, context }: HeroBannerProps): JSX.Element => {
  const mainColor = context.theme?.data.main_color
  return (
    <>
      {slice.variation === "default" ?
        <div className="bg-[#ffffff]">
          <div className="flex flex-col md:flex-row items-center justify-between px-6 py-12 mx-auto max-w-screen-xl">
            <div className="md:flex-1 md:mr-8">
              <PrismicRichText
                field={slice.primary.title}
                components={{
                  heading1: ({ children }) => <h1 className="text-5xl text-center md:text-left text-[#171717] font-sans mb-6">{children}</h1>,
                }}
              />
              <PrismicRichText
                field={slice.primary.subtitle}
                components={{
                  paragraph: ({ children }) => <p className="text-lg text-center md:text-left text-[#000000] font-sans mb-6">{children}</p>,
                }}
              />
              <div className="flex justify-center md:justify-start">
                <PrismicNextLink
                  className="text-white rounded-8px px-8 py-3 font-sans"
                  style={{ backgroundColor: mainColor ? mainColor : "#000000" }}
                  field={slice.primary.button_link}
                >
                  {slice.primary.button_label}
                </PrismicNextLink>
              </div>
            </div>
            <div className="md:flex-1 mt-8 md:mt-0">
              <div className="overflow-hidden rounded-16px">
                <PrismicNextImage
                  className="w-full h-80 md:h-[500px] object-cover"
                  field={slice.primary.hero_image}
                />
              </div>
            </div>
          </div>
        </div>
        :
        <div className="text-white"
          style={{ backgroundColor: mainColor ? mainColor : "#171717" }}>
          <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
            <div className="text-center">
              <PrismicRichText
                field={slice.primary.title}
                components={{
                  heading1: ({ children }) => <h1 className="text-4xl md:text-5xl font-bold mb-8">{children}</h1>,
                }}
              />
              <PrismicRichText
                field={slice.primary.subtitle}
                components={{
                  paragraph: ({ children }) => <p className="mb-12 max-w-lg mx-auto text-lg">{children}</p>,
                }}
              />
              <PrismicNextLink
                className="bg-white text-[#171717] font-bold py-4 px-8 rounded-lg hover:bg-opacity-90 transition duration-300"
                field={slice.primary.button_link}
              >
                {slice.primary.button_label}
              </PrismicNextLink>
            </div>
          </div>
        </div>
      }
    </>
  );
};

export default HeroBanner;