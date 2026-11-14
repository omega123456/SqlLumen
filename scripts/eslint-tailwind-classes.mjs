const CLASS_CONSTANT_FILE = /(?:^|[\\/])(?:class-names[^\\/]*|focus-ring|[^\\/]*-classes)\.ts$/
const THEME_TOKENS_FILE = /(?:^|[\\/])theme-tokens\.ts$/
const CLASS_NAME_ATTRIBUTE = 'className'
const RAW_CSS_VARIABLE = 'var(--'
const CLASS_SEPARATOR = /\s+/
const VARIANT_SEPARATOR = ':'
const LIGHT_UTILITY_MARKER = '-light-'
const DARK_UTILITY_MARKER = '-dark-'
const DARK_VARIANT = 'dark'
const IMPORTANT_PREFIX = '!'
const ARBITRARY_BRACKETS = /[[\]]/
const ARBITRARY_CSS_VARIABLE = '(--'

const MESSAGES = {
  arbitraryValue: 'Class "{{token}}" uses an arbitrary value; add a named @theme token instead',
  importantModifier: 'Class "{{token}}" uses the important modifier',
  interpolatedClass: 'Class strings must be full literals, never built with interpolation',
  missingDarkTwin: 'Class "{{token}}" has no "{{twin}}" twin in the same string',
  rawCssVariable: 'Read CSS variables through src/lib/theme-tokens.ts, not "var(--" strings',
}

function splitClassTokens(text) {
  return text.split(CLASS_SEPARATOR).filter(Boolean)
}

function utilityOf(token) {
  return token.split(VARIANT_SEPARATOR).pop()
}

function variantsOf(token) {
  return token.split(VARIANT_SEPARATOR).slice(0, -1)
}

function isLightToken(token) {
  return utilityOf(token).includes(LIGHT_UTILITY_MARKER)
}

function darkTwinOf(token) {
  const darkUtility = utilityOf(token).replace(LIGHT_UTILITY_MARKER, DARK_UTILITY_MARKER)
  return [DARK_VARIANT, ...variantsOf(token), darkUtility].join(VARIANT_SEPARATOR)
}

function hasArbitraryValue(token) {
  return ARBITRARY_BRACKETS.test(token) || token.includes(ARBITRARY_CSS_VARIABLE)
}

function hasImportantModifier(token) {
  return token.startsWith(IMPORTANT_PREFIX) || token.includes(VARIANT_SEPARATOR + IMPORTANT_PREFIX)
}

function reportToken(context, node, messageId, data) {
  context.report({ node, messageId, data })
}

function checkToken(context, node, token, allTokens) {
  if (hasArbitraryValue(token)) {
    reportToken(context, node, 'arbitraryValue', { token })
  }
  if (hasImportantModifier(token)) {
    reportToken(context, node, 'importantModifier', { token })
  }
  if (!isLightToken(token)) {
    return
  }
  const twin = darkTwinOf(token)
  if (!allTokens.includes(twin)) {
    reportToken(context, node, 'missingDarkTwin', { token, twin })
  }
}

function checkClassString(context, node, text) {
  const tokens = splitClassTokens(text)
  tokens.forEach((token) => checkToken(context, node, token, tokens))
}

function checkTemplateLiteral(context, template) {
  if (template.expressions.length > 0) {
    reportToken(context, template, 'interpolatedClass', {})
    return
  }
  checkClassString(context, template, template.quasis[0].value.cooked)
}

function checkClassNode(context, node) {
  if (node.type === 'Literal' && typeof node.value === 'string') {
    checkClassString(context, node, node.value)
    return
  }
  if (node.type === 'TemplateLiteral') {
    checkTemplateLiteral(context, node)
    return
  }
  if (node.type === 'ConditionalExpression') {
    checkClassNode(context, node.consequent)
    checkClassNode(context, node.alternate)
  }
}

function classAttributeValue(attribute) {
  if (attribute.value?.type === 'JSXExpressionContainer') {
    return attribute.value.expression
  }
  return attribute.value
}

function isClassNameAttribute(attribute) {
  return attribute.name.name === CLASS_NAME_ATTRIBUTE
}

function checkRawCssVariable(context, node, text) {
  if (text.includes(RAW_CSS_VARIABLE)) {
    reportToken(context, node, 'rawCssVariable', {})
  }
}

export const tailwindClassesRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep Tailwind class strings to full literals of named utilities with paired light and dark tokens',
    },
    schema: [],
    messages: MESSAGES,
  },
  create(context) {
    const filename = context.filename
    const isClassConstantFile = CLASS_CONSTANT_FILE.test(filename)
    const mayUseRawCssVariables = THEME_TOKENS_FILE.test(filename)

    return {
      JSXAttribute(attribute) {
        if (!isClassNameAttribute(attribute)) {
          return
        }
        checkClassNode(context, classAttributeValue(attribute))
      },
      Literal(node) {
        if (typeof node.value !== 'string') {
          return
        }
        if (!mayUseRawCssVariables) {
          checkRawCssVariable(context, node, node.value)
        }
        if (isClassConstantFile && node.parent.type !== 'JSXAttribute') {
          checkClassString(context, node, node.value)
        }
      },
      TemplateLiteral(node) {
        if (isClassConstantFile && node.parent.type !== 'JSXExpressionContainer') {
          checkTemplateLiteral(context, node)
        }
      },
      TemplateElement(node) {
        if (!mayUseRawCssVariables) {
          checkRawCssVariable(context, node, node.value.cooked)
        }
      },
    }
  },
}

export const tailwindRulesPlugin = {
  rules: { 'tailwind-classes': tailwindClassesRule },
}
