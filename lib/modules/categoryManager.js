import InfoManager from './infoManager.js';
import HistManager from './histManager.js';
import { getChoseong } from 'es-hangul';
import Utils from './utils.js';
import DocManager from './docManager.js';
import WikiTranslator from './wikiTranslator.js';
import xss from 'xss';
import Translator from 'ken-markup';

export default class CategoryManager {
    static async createCategoryMarkupByCategorizedArr(categorizedArr) {
        let categoryMarkup = '';

        const categorizedInfoArr = await InfoManager.getInfosByDocIdArr(
            categorizedArr
        );

        // prefix -> titleArr
        const prefixMap = Utils.createPrefixMapByInfoArr(categorizedInfoArr);
        const prefixArr = Utils.moveItemToFirstInArr(
            Array.from(prefixMap.keys()).sort(),
            '분류'
        );

        prefixArr.forEach((prefix, i) => {
            categoryMarkup += `\n하위 ${prefix} 문서`;

            const choseongMap = this.createChoseongMapByTitleArr(
                prefixMap.get(prefix)
            );

            categoryMarkup += this.createCategoryMarkupByChoseongMap(
                choseongMap,
                prefix
            );

            if (i + 1 < prefixArr.length) {
                categoryMarkup += '\n----\n';
            }
        });

        return categoryMarkup;
    }

    static createChoseongMapByTitleArr(titleArr) {
        // choseong -> titleArr
        titleArr.sort();
        const choseongMap = new Map();

        titleArr.forEach((title) => {
            const firstChar = title.toUpperCase().charAt(0);
            let choseong = getChoseong(firstChar);
            if (choseong === '') {
                choseong = firstChar;
            }
            if (!Utils.choseongArr.includes(choseong)) {
                choseong = '기타';
            }
            Utils.addItemToArrInMap(choseongMap, choseong, title);
        });

        for (let [choseong, value] of choseongMap) {
            choseongMap.get(choseong).sort();
        }

        return choseongMap;
    }

    static createCategoryMarkupByChoseongMap(choseongMap, prefix) {
        // '\n:' + '(categorized)*keys' + ':'
        let middlePart = '';
        const choseongArr = Array.from(choseongMap.keys());
        choseongArr.sort();
        Utils.moveItemToLastInArr(choseongArr, '기타');
        choseongArr.forEach(choseong => {
            let value = choseongMap.get(choseong).map(title => Translator.toIgnore(xss(title)));
            middlePart += `(${choseong}\n:([[ `;

            if (prefix === '일반') {
                middlePart += value.join(' ]])\n([[ ');
            } else {
                middlePart += value
                    .map((title) => {
                        return `${prefix}:${title}|${title}`;
                    })
                    .join(' ]])\n([[ ');
            }

            middlePart += ' ]]):)';
        });

        return '\n:' + middlePart + ':';
    }

    // static isCategorized(doc) {
    //     // The doc is categorized, including the Uncategorized-category.
    //     const categoryTitleArr = WikiTranslator.getCategoryTitleArr(doc.markup);
    //     return categoryTitleArr.length !== 0;
    // }

    // static isUncategorized(doc) {
    //     // The doc is literally categorized into the Uncategorized-category. It doesn't mean that the doc doesn't have any categories.
    //     const categoryTitleArr = WikiTranslator.getCategoryTitleArr(doc.markup);
    //     return categoryTitleArr.includes('미분류');
    // }

    static getAddCategoryTitleArr(prevDoc, nextDoc) {
        if (prevDoc === null) {
            return WikiTranslator.getCategoryTitleArr(nextDoc.markup);
        } else {
            return Utils.getDiffArr(
                WikiTranslator.getCategoryTitleArr(prevDoc.markup),
                WikiTranslator.getCategoryTitleArr(nextDoc.markup)
            );
        }
    }

    static getRemoveCategoryTitleArr(prevDoc, nextDoc) {
        if (prevDoc === null) {
            return [];
        } else {
            return Utils.getDiffArr(
                WikiTranslator.getCategoryTitleArr(nextDoc.markup),
                WikiTranslator.getCategoryTitleArr(prevDoc.markup)
            );
        }
    }

    static async categorizeDoc(prevDoc, nextDoc, isDeleted = false) {

        const categoryTitleArr = WikiTranslator.getCategoryTitleArr(
            nextDoc.markup
        );
        if (categoryTitleArr.length === 0) {
            if (!isDeleted) {
                nextDoc.markup = '[#[미분류]]\n' + nextDoc.markup;
            }
        } else if (
            categoryTitleArr.includes('미분류') &&
            categoryTitleArr.length >= 2
        ) {
            throw new Error(
                'A document cannot be categorized into both Uncategorized-category and others at the same time!'
            );
        }

        const addCategoryFullTitleArr = Utils.setPrefixToTitleArr(
            this.getAddCategoryTitleArr(prevDoc, nextDoc),
            '분류'
        );
        const removeCategoryFullTitleArr = Utils.setPrefixToTitleArr(
            this.getRemoveCategoryTitleArr(prevDoc, nextDoc),
            '분류'
        );

        // Adding should be the first.
        await this.addDocToCategories(nextDoc.docId, addCategoryFullTitleArr);
        await this.removeDocFromCategories(
            nextDoc.docId,
            removeCategoryFullTitleArr
        );
    }

    static async addDocToCategories(docId, addCategoryFullTitleArr) {
        if (addCategoryFullTitleArr.length === 0) {
            // No categorise to add
            return true;
        } else {
            const addCategoryInfoArr = await InfoManager.getInfosByFullTitleArr(
                addCategoryFullTitleArr
            );
            const addPromiseArr = [];
            const newCategoryIdArr = [];

            addCategoryInfoArr.forEach((categoryInfo, idx) => {
                if (categoryInfo === null) {
                    // new category
                    const newCategoryDoc =
                        DocManager.createNewCategoryDocByFullTitle(
                            addCategoryFullTitleArr[idx],
                            [docId]
                        );
                    newCategoryIdArr.push(newCategoryDoc.docId);
                    addPromiseArr.push(
                        DocManager.setNewDocByDoc(newCategoryDoc)
                    );
                } else if (categoryInfo.state === 'deleted') {
                    // deleted category
                    const prevCategoryDoc = DocManager.createDocByInfo(categoryInfo);
                    const nextCategoryDoc =
                        DocManager.createNextDocByPrevDoc(prevCategoryDoc,
                            { name: 'system'},
                            '[#[미분류]]',
                            '분류 생성'
                        );
                    nextCategoryDoc.categorizedArr.push(docId);
                    newCategoryIdArr.push(nextCategoryDoc.docId);
                    addPromiseArr.push(
                        DocManager.setDeletedDocByDoc(nextCategoryDoc)
                    );
                } else {
                    // existing category
                    categoryInfo.categorizedArr.push(docId);
                    addPromiseArr.push(
                        InfoManager.updateInfoByDoc(categoryInfo)
                    );
                }
            });

            if (newCategoryIdArr.length !== 0) {
                // Add all new categories into the Uncategorized-category
                const uncategorizedInfo = await InfoManager.getInfoByFullTitle(
                    '분류:미분류'
                );
                uncategorizedInfo.categorizedArr.push(...newCategoryIdArr);
                addPromiseArr.push(
                    InfoManager.updateInfoByDoc(uncategorizedInfo)
                );
            }

            return await Promise.allSettled(addPromiseArr);
        }
    }

    static async removeDocFromCategories(docId, removeCategoryFullTitleArr) {
        if (removeCategoryFullTitleArr.length === 0) {
            // No categorise to remove.
            return true;
        } else {
            const [removeInfoMap, deleteInfoArr] =
                await this.analyzeRemovingDocFromCategories(
                    docId,
                    removeCategoryFullTitleArr
                );

            const removePromiseArr = [];
            for (let [key, value] of removeInfoMap) {
                removePromiseArr.push(
                    InfoManager.setInfoByDoc(removeInfoMap.get(key))
                );
            }

            deleteInfoArr.forEach((info) => {
                const prevDoc = DocManager.createDocByInfo(info);
                const nextDoc = DocManager.createNextDocByPrevDoc(
                    prevDoc,
                    { name: 'system' },
                    '',
                    '분류 삭제',
                    'deleted'
                );
                removePromiseArr.push(DocManager.deleteDocByDoc(nextDoc));
            });

            return await Promise.allSettled(removePromiseArr);
        }
    }

    static async analyzeRemovingDocFromCategories(
        docId,
        categoryFullTitleArr,
        removeInfoMap = new Map(),
        deleteInfoArr = []
    ) {
        for (let categoryFullTitle of categoryFullTitleArr) {
            [removeInfoMap, deleteInfoArr] =
                await this.analyzeRemovingDocFromCategory(
                    docId,
                    categoryFullTitle,
                    removeInfoMap,
                    deleteInfoArr
                );
        }
        return [removeInfoMap, deleteInfoArr];
    }

    static async analyzeRemovingDocFromCategory(
        docId,
        categoryFullTitle,
        removeInfoMap,
        deleteInfoArr
    ) {
        let categoryInfo;
        if (!removeInfoMap.has(categoryFullTitle)) {
            categoryInfo = await InfoManager.getInfoByFullTitle(
                categoryFullTitle
            );
            removeInfoMap.set(categoryFullTitle, categoryInfo);
        } else {
            categoryInfo = removeInfoMap.get(categoryFullTitle);
        }

        if (categoryInfo.categorizedArr.length === 1 && categoryInfo.fullTitle !== '분류:미분류' && categoryInfo.fullTitle !== '분류:분류') {
            // This is the only doc categorized into the category.
            removeInfoMap.delete(categoryFullTitle);
            categoryInfo.categorizedArr = [];
            deleteInfoArr.push(categoryInfo);

            const categoryHist = await HistManager.getHistByDocId(
                categoryInfo.docId
            );
            const categoryFullTitleArr = Utils.setPrefixToTitleArr(
                WikiTranslator.getCategoryTitleArr(categoryHist.markup),
                '분류'
            );
            return await this.analyzeRemovingDocFromCategories(
                categoryInfo.docId,
                categoryFullTitleArr,
                removeInfoMap,
                deleteInfoArr
            );
        } else {
            // It is not the only doc.
            categoryInfo.categorizedArr.splice(
                categoryInfo.categorizedArr.indexOf(docId),
                1
            );
            return [removeInfoMap, deleteInfoArr];
        }
    }
}
